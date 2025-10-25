import { getLangfuse } from './langfuse';

/**
 * Fetch prompts from Langfuse Prompt Management
 * This allows you to version and iterate on prompts without code changes
 *
 * To set up:
 * 1. Go to Langfuse UI > Prompts
 * 2. Create prompts with names: 'ocr-gatekeeper', 'ocr-extractor', 'ocr-auditor'
 * 3. These functions will fetch the latest version (or specific version if needed)
 */

export async function getGatekeeperPrompt(): Promise<{ text: string; promptMeta?: { name: string; version: number }; model?: string }> {
  const langfuse = getLangfuse();

  try {
    const prompt = await langfuse.getPrompt('ocr-gatekeeper');
    const modelFromConfig = (prompt.config as any)?.model;
    console.log('✅ Langfuse: Using prompt "ocr-gatekeeper" version', prompt.version, 'from Langfuse');
    if (modelFromConfig) {
      console.log('✅ Langfuse: Model from config:', modelFromConfig);
    }
    return {
      text: prompt.prompt,
      promptMeta: { name: 'ocr-gatekeeper', version: prompt.version },
      model: modelFromConfig
    };
  } catch (error) {
    console.warn('⚠️  Langfuse: Failed to fetch gatekeeper prompt from Langfuse, using hardcoded fallback');
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // Fallback to hardcoded prompt if Langfuse fetch fails
    return {
      text: `You are a quality control gatekeeper for a financial OCR system.

Analyze this image and determine:
1. Is this a financial document (e.g., transaction confirmation, brokerage statement, trade confirmation)?
2. Is the text legible and clear enough to extract data from?

Return your response in this exact JSON format:
{
  "is_financial_document": boolean,
  "is_legible": boolean,
  "reason": "Brief explanation if either check fails"
}`
    };
  }
}

export async function getExtractorPrompt(targetSchema: Record<string, unknown>): Promise<{ text: string; promptMeta?: { name: string; version: number }; model?: string }> {
  const langfuse = getLangfuse();

  try {
    const prompt = await langfuse.getPrompt('ocr-extractor');
    const modelFromConfig = (prompt.config as any)?.model;
    console.log('✅ Langfuse: Using prompt "ocr-extractor" version', prompt.version, 'from Langfuse');
    if (modelFromConfig) {
      console.log('✅ Langfuse: Model from config:', modelFromConfig);
    }

    // Langfuse prompts support variables - compile with the schema
    return {
      text: prompt.compile({
        targetSchema: JSON.stringify(targetSchema, null, 2)
      }),
      promptMeta: { name: 'ocr-extractor', version: prompt.version },
      model: modelFromConfig
    };
  } catch (error) {
    console.warn('⚠️  Langfuse: Failed to fetch extractor prompt from Langfuse, using hardcoded fallback');
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // Fallback to hardcoded prompt
    return {
      text: `You are a financial document data extraction specialist.

This image may contain ONE OR MORE transactions. Extract ALL visible transactions.

For each transaction, extract the following information:
${JSON.stringify(targetSchema, null, 2)}

For each field you extract, provide a confidence score between 0 and 1 based on:
- Text clarity (0.8-1.0 for clear text, 0.5-0.8 for slightly unclear, below 0.5 for very unclear)
- Field presence (1.0 if explicitly stated, 0.7-0.9 if inferred, below 0.7 if guessed)

Return your response in this exact JSON format (array of transactions):
{
  "transactions": [
    {
      "extractedData": {
        "field1": "value1",
        "field2": "value2"
      },
      "confidenceScores": {
        "field1": 0.95,
        "field2": 0.85
      }
    },
    {
      "extractedData": {
        "field1": "value1",
        "field2": "value2"
      },
      "confidenceScores": {
        "field1": 0.90,
        "field2": 0.80
      }
    }
  ]
}

If a field is not visible or unclear, omit it from extractedData and set its confidence to 0.`
    };
  }
}

export async function getAuditorPrompt(extractorOutput: any): Promise<{ text: string; promptMeta?: { name: string; version: number }; model?: string }> {
  const langfuse = getLangfuse();

  try {
    const prompt = await langfuse.getPrompt('ocr-auditor');
    const modelFromConfig = (prompt.config as any)?.model;
    console.log('✅ Langfuse: Using prompt "ocr-auditor" version', prompt.version, 'from Langfuse');
    if (modelFromConfig) {
      console.log('✅ Langfuse: Model from config:', modelFromConfig);
    }

    // Compile with the extractor output
    return {
      text: prompt.compile({
        extractedTransactions: JSON.stringify(extractorOutput.transactions, null, 2)
      }),
      promptMeta: { name: 'ocr-auditor', version: prompt.version },
      model: modelFromConfig
    };
  } catch (error) {
    console.warn('⚠️  Langfuse: Failed to fetch auditor prompt from Langfuse, using hardcoded fallback');
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // Fallback to hardcoded prompt
    return {
      text: `You are a financial data auditor. Review EACH transaction for SEMANTIC issues only.

NOTE: Math, date validation, and format checks are already handled. Focus on:
- Does the description match the symbol?
- Does the transaction make logical sense in context?
- Are there any unusual patterns or red flags?

Extracted Transactions (with existing warnings from deterministic validation):
${JSON.stringify(extractorOutput.transactions, null, 2)}

Return your response in this exact JSON format (preserve existing warnings, add new ones if needed):
{
  "transactions": [
    {
      "validatedData": {
        "field1": "value1",
        "field2": "value2"
      },
      "confidenceScores": {
        "field1": 0.90,
        "field2": 0.75
      },
      "warnings": [
        "Warning: Description mentions 'Apple' but symbol is MSFT"
      ]
    }
  ]
}

You can adjust confidence scores if you detect semantic issues.
If everything looks semantically correct, return the data as-is with existing warnings.`
    };
  }
}
