import axios from "axios";
import logger from "../../utils/logger";

const VOYAGE_MODEL = process.env.VOYAGE_MODEL || "voyage-4";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
// Voyage's per-request text-count limit is 1000, but accounts with no
// billing method on file are also capped at 10K tokens/min — a single
// request bundling ~200+ short chunks can blow past that on its own, no
// matter how well-spaced the requests are. Keep sub-batches small so one
// request's token usage can't exceed the per-minute budget by itself.
const BATCH_SIZE = Number(process.env.VOYAGE_BATCH_SIZE) || 40;

// Voyage accounts with no billing method on file are capped at 3 requests/min
// (see the 429 body: "reduced rate limits of 3 RPM"). Rather than firing
// calls back-to-back and reactively retrying after Voyage rejects them, space
// every outbound call at least MIN_CALL_INTERVAL_MS apart process-wide —
// comfortably under 3/min — and still retry on top of that as a safety net
// for jitter/clock drift.
const MIN_CALL_INTERVAL_MS = 25_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000;

let lastCallAt = 0;

interface VoyageEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits out whatever's left of the minimum gap since the last Voyage call. */
async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < MIN_CALL_INTERVAL_MS) {
    await sleep(MIN_CALL_INTERVAL_MS - elapsed);
  }
  lastCallAt = Date.now();
}

/**
 * Embed a batch of texts via Voyage AI (Anthropic's recommended embeddings
 * partner — Anthropic has no first-party embedding model). `input_type`
 * must always be set to "query" or "document": per Voyage's own guidance,
 * omitting it measurably hurts retrieval quality.
 */
export async function embedTexts(
  texts: string[],
  inputType: "query" | "document",
): Promise<number[][]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is not configured");
  }
  if (texts.length === 0) return [];

  const results: number[][] = new Array(texts.length);

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);

    let attempt = 0;
    for (;;) {
      await throttle();
      try {
        const { data } = await axios.post<VoyageEmbeddingResponse>(
          VOYAGE_URL,
          {
            input: batch,
            model: VOYAGE_MODEL,
            input_type: inputType,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
              "Content-Type": "application/json",
            },
          },
        );

        for (const item of data.data) {
          results[start + item.index] = item.embedding;
        }
        break;
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 429 && attempt < MAX_RETRIES) {
          attempt++;
          logger.warn(
            `Voyage embeddings rate-limited (429), retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`,
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
  }

  return results;
}

/** Convenience for the common single-text case (e.g. embedding a user question). */
export async function embedText(
  text: string,
  inputType: "query" | "document",
): Promise<number[]> {
  const [embedding] = await embedTexts([text], inputType);
  return embedding;
}
