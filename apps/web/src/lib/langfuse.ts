import { Langfuse } from "langfuse";

// Initialize Langfuse client
let langfuseInstance: Langfuse | null = null;

export function getLangfuse(): Langfuse {
  if (!langfuseInstance) {
    langfuseInstance = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST,
    });
  }
  return langfuseInstance;
}

/**
 * Fetch model configuration for a specific OCR stage from Langfuse
 * Falls back to default model if not configured
 */
export async function getOcrModelConfig(stage: 'gatekeeper' | 'extractor' | 'auditor'): Promise<string> {
  const langfuse = getLangfuse();
  const defaultModel = 'gemini-2.0-flash-exp';
  const promptName = `ocr-${stage}-model`;

  try {
    // Fetch production version by label
    const prompt = await langfuse.getPrompt(promptName, undefined, { label: 'production' });

    // Check config first (JSON object), then fall back to prompt text
    const modelName = (prompt.config as any)?.model || prompt.prompt;
    console.log(`✅ Langfuse: Using ${stage} model from config:`, modelName, `(version ${prompt.version}, label: production)`);
    return modelName;
  } catch (error) {
    console.log(`ℹ️  Langfuse: No ${stage} model config found, using default:`, defaultModel);
    return defaultModel;
  }
}

// Ensure all events are flushed before shutdown
export async function shutdownLangfuse() {
  if (langfuseInstance) {
    await langfuseInstance.shutdownAsync();
  }
}
