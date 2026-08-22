import mongoose, { Document, Schema } from "mongoose";

/**
 * EmbeddingChunk — one embedded, retrievable chunk backing the shared RAG
 * layer (see service/rag/rag.service.ts). Every chunk carries its own
 * branchId + allowedRoles so that Atlas Vector Search can pre-filter on
 * scope *before* running the ANN search — scoping must never be applied
 * as a post-search filter. `chunkId` is deterministic (`${sourceType}:${sourceId}`)
 * since v1 embeds one chunk per source document (no sub-chunking).
 */
export interface IEmbeddingChunk extends Document {
  chunkId: string;
  sourceType: string;
  sourceId: mongoose.Types.ObjectId;
  branchId: string;
  allowedRoles: string[];
  text: string;
  embedding: number[];
  joinKeys: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const EmbeddingChunkSchema = new Schema<IEmbeddingChunk>(
  {
    chunkId: {
      type: String,
      required: true,
      unique: true,
    },
    sourceType: {
      type: String,
      required: true,
      index: true,
    },
    sourceId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    branchId: {
      type: String,
      required: true,
      index: true,
    },
    allowedRoles: {
      type: [String],
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
    joinKeys: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

EmbeddingChunkSchema.index({ sourceType: 1, branchId: 1 });

export const EmbeddingChunkModel = mongoose.model<IEmbeddingChunk>(
  "EmbeddingChunk",
  EmbeddingChunkSchema,
);
