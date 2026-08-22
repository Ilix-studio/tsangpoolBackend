import mongoose, { Document, Schema } from "mongoose";
import { DatasetType, DATASET_TYPES } from "./datasetRegistry";
import { NormalizedRow } from "../../utils/dataImport/columnMatcher";

/**
 * ImportedRow — one document per parsed row of an uploaded dealer export.
 * `rowData` preserves every source column untouched (strict:false, mirrors
 * PartsReport.ts / StockConceptCSV.ts); `normalized` holds the canonical,
 * type-coerced superset used for cross-dataset joins and aggregation (see
 * utils/dataImport/columnMatcher.ts#NormalizedRow). Interim de-duplication
 * key: rowHash scoped per branch + datasetType.
 */
export interface IImportedRow extends Document {
  rowId: string;
  dataset: mongoose.Types.ObjectId;
  batchId: string;
  datasetType: DatasetType;
  rowData: Record<string, any>;
  normalized: NormalizedRow;
  rowHash: string;
  sourceFormat: "xlsx" | "csv" | "pdf";
  needsReview: boolean;
  branchId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ImportedRowSchema = new Schema<IImportedRow>(
  {
    rowId: { type: String, required: true, unique: true, index: true },
    dataset: {
      type: Schema.Types.ObjectId,
      ref: "ImportedDataset",
      required: true,
      index: true,
    },
    batchId: { type: String, required: true, index: true },
    datasetType: { type: String, enum: DATASET_TYPES, required: true },
    rowData: { type: Schema.Types.Mixed, required: true },
    normalized: { type: Schema.Types.Mixed, default: {} },
    rowHash: { type: String, required: true },
    sourceFormat: { type: String, enum: ["xlsx", "csv", "pdf"], required: true },
    needsReview: { type: Boolean, default: false },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    strict: false, // preserve arbitrary source columns beyond the defined ones
  },
);

// Interim de-dup key: same normalized row content within the same branch + dataset type.
// Scoped to active rows only, so a soft-deleted batch (isActive: false) never
// blocks re-importing the same data.
ImportedRowSchema.index(
  { branchId: 1, datasetType: 1, rowHash: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
ImportedRowSchema.index({ datasetType: 1, "normalized.frameNumber": 1 });
ImportedRowSchema.index({ datasetType: 1, "normalized.jobCardNumber": 1 });
ImportedRowSchema.index({ datasetType: 1, "normalized.jobCardClosedDate": 1 });

export const ImportedRowModel = mongoose.model<IImportedRow>(
  "ImportedRow",
  ImportedRowSchema,
);
