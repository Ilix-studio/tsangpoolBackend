import mongoose from "mongoose";
import dotenv from "dotenv";
import { EmbeddingChunkModel } from "../models/RAG/EmbeddingChunk";

dotenv.config();

/**
 * One-off admin script: creates the Atlas Vector Search index backing the
 * RAG layer. Idempotent — safe to re-run; skips if the index already exists.
 *
 * Atlas Search/Vector indexes are environment infrastructure (like a
 * migration), not app runtime logic, so this is run manually per environment
 * rather than on every server boot:
 *
 *   npm run rag:create-index
 */
const INDEX_NAME = "rag_vector_index";
const EMBEDDING_DIMENSIONS = 1024; // voyage-4 default output dimension

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not configured");

  await mongoose.connect(uri);
  const collection = EmbeddingChunkModel.collection as any;

  const existing = await collection
    .listSearchIndexes(INDEX_NAME)
    .toArray()
    .catch(() => []);

  if (existing.length > 0) {
    console.log(`Vector index "${INDEX_NAME}" already exists — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  await collection.createSearchIndex({
    name: INDEX_NAME,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: EMBEDDING_DIMENSIONS,
          similarity: "cosine",
        },
        { type: "filter", path: "branchId" },
        { type: "filter", path: "allowedRoles" },
        { type: "filter", path: "sourceType" },
      ],
    },
  });

  console.log(
    `Created vector search index "${INDEX_NAME}". It may take a few minutes to finish building before it's queryable.`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Failed to create vector search index:", err);
  process.exit(1);
});
