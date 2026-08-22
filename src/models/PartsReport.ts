import mongoose, { Document, Schema } from "mongoose";
import { PartsStockNormalizedRow } from "../utils/partsColumnMatcher";

/**
 * PartsReport — one row extracted from an uploaded parts-stock report
 * (XLSX / CSV / PDF). Every source column is preserved in `rowData`
 * (`strict: false`); `normalized` holds the canonical, type-coerced fields
 * (Part Number/Description/Quantity/Unit Price/Location) used for
 * diffing, aggregation, and display — see utils/partsColumnMatcher.ts and
 * service/partsStockDiff.service.ts.
 *
 * Persistence is diff-based, not content-hash dedup: each upload is compared
 * against the current snapshot (rows with `isCurrent: true`) keyed by
 * Part Number, and only genuinely new/changed rows are inserted. `isCurrent`
 * is distinct from `isActive` (a batch-level soft-delete flag) — a
 * superseded or removed part flips to `isCurrent: false` but is never
 * deleted, so batch history stays intact.
 */
export interface IPartsReport extends Document {
  partId: string;
  rowData: Record<string, any>;
  normalized: PartsStockNormalizedRow;
  rowHash: string;
  detectedColumns: string[];
  sourceFormat: "xlsx" | "csv" | "pdf";
  importBatch: string;
  importDate: Date;
  fileName: string;
  branchId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  needsReview: boolean;
  isActive: boolean;
  isCurrent: boolean;
  changeType?: "added" | "changed";
  createdAt: Date;
  updatedAt: Date;
}

const PartsReportSchema = new Schema<IPartsReport>(
  {
    partId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    rowData: {
      type: Schema.Types.Mixed,
      required: true,
    },
    normalized: {
      type: Schema.Types.Mixed,
      default: {},
    },
    rowHash: {
      type: String,
      required: true,
      index: true,
    },
    detectedColumns: {
      type: [String],
      default: [],
    },
    sourceFormat: {
      type: String,
      enum: ["xlsx", "csv", "pdf"],
      required: true,
    },
    importBatch: {
      type: String,
      required: true,
      index: true,
    },
    importDate: {
      type: Date,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    needsReview: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isCurrent: {
      type: Boolean,
      default: true,
    },
    changeType: {
      type: String,
      enum: ["added", "changed"],
    },
  },
  {
    timestamps: true,
    strict: false, // preserve arbitrary source columns beyond the defined ones
  },
);

// At most one "current" row per Part Number per branch — enforced at the DB
// level. Not unique across all rows (only where isCurrent: true), so a
// part's value reverting to a previously-seen exact value in a later upload
// never collides with its own (now superseded) history.
PartsReportSchema.index(
  { branchId: 1, "normalized.partNumber": 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);

export const PartsReportModel = mongoose.model<IPartsReport>(
  "PartsReport",
  PartsReportSchema,
);
