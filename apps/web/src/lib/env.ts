/**
 * Environment variable validation
 * Validates required environment variables at application startup
 */

interface EnvConfig {
  DATABASE_URL: string;
  GEMINI_API_KEY: string | undefined;
  POLYGON_API_KEY: string | undefined;
  LANGFUSE_PUBLIC_KEY: string | undefined;
  LANGFUSE_SECRET_KEY: string | undefined;
  LANGFUSE_HOST: string | undefined;
  NODE_ENV: 'development' | 'production' | 'test';
}

function validateEnv(): EnvConfig {
  // Critical environment variables (required for app to function)
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Run ./scripts/pull-secrets.sh to set up local environment.'
    );
  }

  // Optional environment variables (app can run without them but with degraded functionality)
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
  const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
  const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
  const LANGFUSE_HOST = process.env.LANGFUSE_HOST;

  // Warn about missing optional variables
  if (!GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY not set - OCR functionality will not work');
  }
  if (!POLYGON_API_KEY) {
    console.warn('⚠️  POLYGON_API_KEY not set - stock/ETF price fetching may be limited');
  }
  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
    console.warn('⚠️  Langfuse keys not set - observability will be disabled');
  }

  const NODE_ENV = (process.env.NODE_ENV || 'development') as EnvConfig['NODE_ENV'];

  return {
    DATABASE_URL,
    GEMINI_API_KEY,
    POLYGON_API_KEY,
    LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY,
    LANGFUSE_HOST,
    NODE_ENV,
  };
}

// Validate and export environment variables
export const env = validateEnv();
