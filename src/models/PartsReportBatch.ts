import mongoose, { Document, Schema } from "mongoose";
import { UserRole, ROLES } from "../types/user.types";

/**
 * PartsReportBatch — one document per parts-stock upload, holding the
 * upload-over-upload comparison summary (added/changed/removed counts,
 * revenue before/after, the rendered changelog). The rows themselves live in
 * PartsReport, referencing this document via `batchId`. Kept as a separate,
 * lightweight model (rather than denormalizing the summary onto every row)
 * since a single upload can touch thousands of rows.
 */
export interface IPartsReportBatch extends Document {
  batchId: string;
  fileName: string;
  sourceFormat: "xlsx" | "csv" | "pdf";
  detectedColumns: string[];
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  reviewRows: number;
  status: "completed" | "completed_with_errors" | "failed";
  branchId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedByRole: UserRole;
  isActive: boolean;

  previousBatchId?: string | null;
  addedRows: number;
  changedRows: number;
  removedRows: number;
  unchangedRows: number;
  revenueBefore: number;
  revenueAfter: number;
  revenueDelta: number;
  changesMarkdown: string;

  createdAt: Date;
  updatedAt: Date;
}

const PartsReportBatchSchema = new Schema<IPartsReportBatch>(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    fileName: { type: String, required: true },
    sourceFormat: { type: String, enum: ["xlsx", "csv", "pdf"], required: true },
    detectedColumns: { type: [String], default: [] },
    totalRows: { type: Number, default: 0 },
    importedRows: { type: Number, default: 0 },
    duplicateRows: { type: Number, default: 0 },
    reviewRows: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["completed", "completed_with_errors", "failed"],
      default: "completed",
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    uploadedByRole: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },
    isActive: { type: Boolean, default: true },

    previousBatchId: { type: String, default: null },
    addedRows: { type: Number, default: 0 },
    changedRows: { type: Number, default: 0 },
    removedRows: { type: Number, default: 0 },
    unchangedRows: { type: Number, default: 0 },
    revenueBefore: { type: Number, default: 0 },
    revenueAfter: { type: Number, default: 0 },
    revenueDelta: { type: Number, default: 0 },
    changesMarkdown: { type: String, default: "" },
  },
  {
    timestamps: true,
    strict: true,
  },
);

PartsReportBatchSchema.index({ branchId: 1, createdAt: -1 });

export const PartsReportBatchModel = mongoose.model<IPartsReportBatch>(
  "PartsReportBatch",
  PartsReportBatchSchema,
);
