import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { getLangfuse } from '@/lib/langfuse';
import { getGatekeeperPrompt, getExtractorPrompt, getAuditorPrompt } from '@/lib/ocr-prompts';
import { runDeterministicValidation } from '@/lib/ocr-validation';
import { getUploadPath } from '@/lib/storage';
import { rateLimit, RateLimitConfig } from '@/lib/rate-limit';
import { getAuthUser } from '@/lib/firebase/server';

interface OcrRequest {
  imageData: string;
  targetSchema: Record<string, unknown>;
}


interface GatekeeperOutput {
  is_financial_document: boolean;
  is_legible: boolean;
  reason?: string;
}

interface TransactionData {
  extractedData: Record<string, unknown>;
  confidenceScores: Record<string, number>;
  warnings?: string[];
}

interface ExtractorOutput {
  transactions: TransactionData[];
}

interface ValidatedTransaction {
  validatedData: Record<string, unknown>;
  confidenceScores: Record<string, number>;
  warnings: string[];
}

interface AuditorOutput {
  transactions: ValidatedTransaction[];
}

interface OcrResponse {
  success: boolean;
  imagePath: string;
  gatekeeperOutput: GatekeeperOutput;
  extractorOutput: ExtractorOutput;
  auditorOutput: AuditorOutput;
  error?: string;
}

export async function POST(request: NextRequest) {
  // Authentication check - OCR is expensive and sensitive
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Rate limiting - 10 OCR requests per hour (expensive Gemini API calls)
  // Use user ID for rate limiting instead of IP for authenticated users
  const rateLimitKey = `ocr:user:${user.id}`;
  const rateLimitResult = await rateLimit(
    rateLimitKey,
    RateLimitConfig.OCR
  );

  if (!rateLimitResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many OCR requests. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimitResult.reset - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(RateLimitConfig.OCR.limit),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': String(rateLimitResult.reset),
        },
      }
    );
  }

  const langfuse = getLangfuse();
  const trace = langfuse.trace({
    name: 'ocr-transaction-processing',
    metadata: {
      endpoint: '/api/ocr',
    },
  });

  try {
    const body = await request.json() as OcrRequest;
    const { imageData, targetSchema } = body;

    // Add input metadata to trace (include full imageData for Langfuse dataset replay)
    trace.update({
      input: {
        imageData, // Full base64 image data for dataset replay
        targetSchema,
        imageSize: imageData.length,
      },
    });

    // Validate required parameters
    if (!imageData) {
      trace.update({ output: { error: 'Missing imageData' } });
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: imageData' },
        { status: 400 }
      );
    }

    if (!targetSchema) {
      trace.update({ output: { error: 'Missing targetSchema' } });
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: targetSchema' },
        { status: 400 }
      );
    }

    // Validate GEMINI_API_KEY is configured
    if (!process.env.GEMINI_API_KEY) {
      trace.update({ output: { error: 'GEMINI_API_KEY not configured' } });
      return NextResponse.json(
        { success: false, error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Parse and validate base64 image data
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');

    // Validate base64 format
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      trace.update({ output: { error: 'Invalid base64 data' } });
      return NextResponse.json(
        { success: false, error: 'Invalid image data format' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(base64Data, 'base64');

    // Validate image size (max 10MB)
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
    if (buffer.length > MAX_IMAGE_SIZE) {
      trace.update({ output: { error: 'Image too large' } });
      return NextResponse.json(
        { success: false, error: 'Image too large (max 10MB)' },
        { status: 400 }
      );
    }

    // Save to uploads directory with unique filename
    const filename = `${randomUUID()}.png`;
    const imagePath = await getUploadPath(filename);
    await writeFile(imagePath, buffer);

    trace.update({
      metadata: {
        imagePath,
        imageFilename: filename,
      },
    });

    // STAGE 1: Gatekeeper - Quality Control
    const gatekeeperOutput = await runGatekeeper(genAI, base64Data, trace);

    if (!gatekeeperOutput.is_financial_document || !gatekeeperOutput.is_legible) {
      trace.update({
        output: { gatekeeperOutput, error: 'Failed quality checks' },
      });
      return NextResponse.json({
        success: false,
        imagePath,
        gatekeeperOutput,
        extractorOutput: { transactions: [] },
        auditorOutput: { transactions: [] },
        error: gatekeeperOutput.reason || 'Document failed quality checks',
      });
    }

    // STAGE 2: Extractor - RAG-Powered Extraction
    const extractorOutput = await runExtractor(genAI, base64Data, targetSchema, trace);

    // STAGE 2.5: Deterministic Validation (before AI Auditor)
    const validatedOutput = runDeterministicValidation(extractorOutput);

    // STAGE 3: Auditor - Validation & Reasoning (focused on semantic issues only)
    const auditorOutput = await runAuditor(genAI, validatedOutput, trace);

    trace.update({
      output: {
        success: true,
        transactionCount: auditorOutput.transactions.length,
        gatekeeperOutput,
        auditorSummary: auditorOutput.transactions.map(t => ({
          warnings: t.warnings.length,
          avgConfidence: Object.values(t.confidenceScores).reduce((a, b) => a + b, 0) / Object.values(t.confidenceScores).length,
        })),
      },
    });

    return NextResponse.json({
      success: true,
      imagePath,
      gatekeeperOutput,
      extractorOutput,
      auditorOutput,
      traceId: trace.id,
    } as OcrResponse & { traceId: string });

  } catch (error) {
    console.error('OCR processing error:', error);
    trace.update({
      output: { error: String(error) },
    });
    return NextResponse.json(
      { success: false, error: 'Failed to process transaction image' },
      { status: 500 }
    );
  } finally {
    await langfuse.flushAsync();
  }
}

/**
 * STAGE 1: Gatekeeper
 * Checks if the image is a relevant financial document and is legible
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runGatekeeper(
  genAI: GoogleGenerativeAI,
  base64Data: string,
  trace: any
): Promise<GatekeeperOutput> {
  const span = trace.span({
    name: 'gatekeeper',
    metadata: {
      stage: 'quality-control',
    },
  });

  // Fetch prompt from Langfuse (or use fallback)
  const promptData = await getGatekeeperPrompt();

  // Use model from prompt config, or fall back to default
  const modelName = promptData.model || 'gemini-2.0-flash-exp';
  const model = genAI.getGenerativeModel({ model: modelName });

  span.update({
    input: {
      prompt: promptData.text,
      imageData: `data:image/png;base64,${base64Data}`, // Include image for dataset replay
      imageSize: base64Data.length,
    },
    metadata: {
      promptSource: promptData.promptMeta ? 'langfuse' : 'fallback',
      promptVersion: promptData.promptMeta?.version,
    },
  });

  const generation = span.generation({
    name: 'gemini-gatekeeper',
    model: modelName,
    modelParameters: {
      mimeType: 'image/png',
    },
    input: [
      { type: 'text', text: promptData.text },
      { type: 'image', image: `data:image/png;base64,${base64Data}` }
    ],
    prompt: promptData.promptMeta,
  });

  const startTime = Date.now();

  const result = await model.generateContent([
    promptData.text,
    {
      inlineData: {
        mimeType: 'image/png',
        data: base64Data
      }
    }
  ]);

  const response = await result.response;
  const text = response.text();
  const latency = Date.now() - startTime;

  // Track usage metadata
  const usageMetadata = response.usageMetadata;
  generation.update({
    output: text,
    usage: {
      input: usageMetadata?.promptTokenCount || 0,
      output: usageMetadata?.candidatesTokenCount || 0,
      total: usageMetadata?.totalTokenCount || 0,
    },
    metadata: {
      latencyMs: latency,
    },
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    span.update({ output: { error: 'Failed to parse JSON' } });
    throw new Error('Failed to parse JSON from Gatekeeper response');
  }

  const output = JSON.parse(jsonMatch[0]) as GatekeeperOutput;

  span.update({
    output,
    metadata: {
      isFinancialDocument: output.is_financial_document,
      isLegible: output.is_legible,
    },
  });

  generation.end();
  span.end();

  return output;
}

/**
 * STAGE 2: Extractor
 * Extracts structured data from the image based on the provided schema
 * IMPORTANT: Can extract MULTIPLE transactions from a single image
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runExtractor(
  genAI: GoogleGenerativeAI,
  base64Data: string,
  targetSchema: Record<string, unknown>,
  trace: any
): Promise<ExtractorOutput> {
  const span = trace.span({
    name: 'extractor',
    metadata: {
      stage: 'data-extraction',
      targetSchema,
    },
  });

  // Fetch prompt from Langfuse (or use fallback)
  const promptData = await getExtractorPrompt(targetSchema);

  // Use model from prompt config, or fall back to default
  const modelName = promptData.model || 'gemini-2.0-flash-exp';
  const model = genAI.getGenerativeModel({ model: modelName });

  span.update({
    input: {
      prompt: promptData.text,
      imageData: `data:image/png;base64,${base64Data}`, // Include image for dataset replay
      imageSize: base64Data.length,
      targetSchema,
    },
    metadata: {
      promptSource: promptData.promptMeta ? 'langfuse' : 'fallback',
      promptVersion: promptData.promptMeta?.version,
    },
  });

  const generation = span.generation({
    name: 'gemini-extractor',
    model: modelName,
    modelParameters: {
      mimeType: 'image/png',
    },
    input: [
      { type: 'text', text: promptData.text },
      { type: 'image', image: `data:image/png;base64,${base64Data}` }
    ],
    prompt: promptData.promptMeta,
  });

  const startTime = Date.now();

  const result = await model.generateContent([
    promptData.text,
    {
      inlineData: {
        mimeType: 'image/png',
        data: base64Data
      }
    }
  ]);

  const response = await result.response;
  const text = response.text();
  const latency = Date.now() - startTime;

  // Track usage metadata
  const usageMetadata = response.usageMetadata;
  generation.update({
    output: text,
    usage: {
      input: usageMetadata?.promptTokenCount || 0,
      output: usageMetadata?.candidatesTokenCount || 0,
      total: usageMetadata?.totalTokenCount || 0,
    },
    metadata: {
      latencyMs: latency,
    },
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    span.update({ output: { error: 'Failed to parse JSON' } });
    throw new Error('Failed to parse JSON from Extractor response');
  }

  const output = JSON.parse(jsonMatch[0]) as ExtractorOutput;

  span.update({
    output,
    metadata: {
      transactionCount: output.transactions.length,
      avgConfidence: output.transactions.map(t =>
        Object.values(t.confidenceScores).reduce((a, b) => a + b, 0) / Object.values(t.confidenceScores).length
      ),
    },
  });

  generation.end();
  span.end();

  return output;
}

// Deterministic validation is now in @/lib/ocr-validation

/**
 * STAGE 3: Auditor
 * Reviews the extracted JSON for SEMANTIC issues only (not math/format)
 * Deterministic rules are handled in Stage 2.5
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAuditor(
  genAI: GoogleGenerativeAI,
  extractorOutput: ExtractorOutput,
  trace: any
): Promise<AuditorOutput> {
  const span = trace.span({
    name: 'auditor',
    metadata: {
      stage: 'semantic-validation',
      transactionCount: extractorOutput.transactions.length,
    },
  });

  // Fetch prompt from Langfuse (or use fallback)
  const promptData = await getAuditorPrompt(extractorOutput);

  // Use model from prompt config, or fall back to default
  const modelName = promptData.model || 'gemini-2.0-flash-exp';
  const model = genAI.getGenerativeModel({ model: modelName });

  span.update({
    input: {
      prompt: promptData.text,
      extractorOutput,
    },
    metadata: {
      promptSource: promptData.promptMeta ? 'langfuse' : 'fallback',
      promptVersion: promptData.promptMeta?.version,
    },
  });

  const generation = span.generation({
    name: 'gemini-auditor',
    model: modelName,
    input: promptData.text,
    prompt: promptData.promptMeta,
  });

  const startTime = Date.now();

  const result = await model.generateContent([promptData.text]);
  const response = await result.response;
  const text = response.text();
  const latency = Date.now() - startTime;

  // Track usage metadata
  const usageMetadata = response.usageMetadata;
  generation.update({
    output: text,
    usage: {
      input: usageMetadata?.promptTokenCount || 0,
      output: usageMetadata?.candidatesTokenCount || 0,
      total: usageMetadata?.totalTokenCount || 0,
    },
    metadata: {
      latencyMs: latency,
    },
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    span.update({ output: { error: 'Failed to parse JSON' } });
    throw new Error('Failed to parse JSON from Auditor response');
  }

  const auditorResponse = JSON.parse(jsonMatch[0]) as AuditorOutput;

  // Ensure all transactions have validatedData (fallback to extractedData if AI didn't return it)
  const validatedTransactions = auditorResponse.transactions.map((transaction, index) => {
    const sourceTransaction = extractorOutput.transactions[index];

    return {
      validatedData: transaction.validatedData || sourceTransaction.extractedData,
      confidenceScores: transaction.confidenceScores || sourceTransaction.confidenceScores,
      warnings: [
        ...(sourceTransaction.warnings || []), // Deterministic warnings
        ...(transaction.warnings || []),        // AI warnings
      ],
    };
  });

  const output = {
    transactions: validatedTransactions,
  };

  span.update({
    output,
    metadata: {
      transactionCount: output.transactions.length,
      totalWarnings: output.transactions.reduce((sum, t) => sum + t.warnings.length, 0),
      avgConfidence: output.transactions.map(t =>
        Object.values(t.confidenceScores).reduce((a, b) => a + b, 0) / Object.values(t.confidenceScores).length
      ),
    },
  });

  generation.end();
  span.end();

  return output;
}
