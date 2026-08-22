import logger from "../utils/logger";

const SCANFLEET_PLACEHOLDERS = ["sf_live_...", "sf_secret_..."];

function isPlaceholder(value: string): boolean {
  return SCANFLEET_PLACEHOLDERS.includes(value) || value.endsWith("...");
}

/**
 * Runs once at startup, after dotenv has loaded. Anthropic is feature-scoped
 * (Parts AI assistant + RAG) so a missing/malformed key only warns; ScanFleet
 * placeholder values are rejected fatally since setting.scanfleet.ts's own
 * non-empty check would otherwise let them through and only fail later as an
 * opaque 502 on a real customer request.
 */
export function validateRequiredEnv(): void {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    logger.warn(
      "ANTHROPIC_API_KEY is not set — Parts AI assistant (POST /api/parts/ai) and RAG search will be unavailable.",
    );
  } else if (!anthropicKey.startsWith("sk-ant-")) {
    logger.warn(
      "ANTHROPIC_API_KEY does not look like a valid Anthropic key (expected to start with 'sk-ant-') — Parts AI assistant and RAG search may fail.",
    );
  }

  const scanfleetVars = {
    SCANFLEET_API_KEY: process.env.SCANFLEET_API_KEY,
    SCANFLEET_API_SECRET: process.env.SCANFLEET_API_SECRET,
  };
  for (const [name, value] of Object.entries(scanfleetVars)) {
    if (value && isPlaceholder(value)) {
      throw new Error(
        `${name} is still set to a placeholder value ("${value}") in the .env file — replace it with a real ScanFleet credential before starting the server.`,
      );
    }
  }
}
