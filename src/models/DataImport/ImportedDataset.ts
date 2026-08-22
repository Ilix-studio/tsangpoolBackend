import mongoose, { Document, Schema } from "mongoose";
import { DatasetType, DATASET_TYPES } from "./datasetRegistry";
import { UserRole, ROLES } from "../../types/user.types";

export interface IMatchedField {
  canonicalKey: string;
  label: string;
  sourceColumn: string;
}

/**
 * ImportedDataset — one document per upload (a "batch"). Stores parsing
 * metadata and totals; the actual rows live in ImportedRow, referencing this
 * document via `dataset`/`batchId`.
 */
export interface IImportedDataset extends Document {
  batchId: string;
  datasetType: DatasetType;
  fileName: string;
  sourceFormat: "xlsx" | "csv" | "pdf";
  sheetUsed?: string;
  availableSheets?: string[];
  detectedColumns: string[];
  matchedFields: IMatchedField[];
  unmatchedColumns: string[];
  missingRequired: string[];
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  reviewRows: number;
  status: "completed" | "completed_with_errors" | "failed";
  branchId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedByRole: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MatchedFieldSchema = new Schema<IMatchedField>(
  {
    canonicalKey: { type: String, required: true },
    label: { type: String, required: true },
    sourceColumn: { type: String, required: true },
  },
  { _id: false },
);

const ImportedDatasetSchema = new Schema<IImportedDataset>(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    datasetType: { type: String, enum: DATASET_TYPES, required: true, index: true },
    fileName: { type: String, required: true },
    sourceFormat: { type: String, enum: ["xlsx", "csv", "pdf"], required: true },
    sheetUsed: { type: String },
    availableSheets: { type: [String], default: undefined },
    detectedColumns: { type: [String], default: [] },
    matchedFields: { type: [MatchedFieldSchema], default: [] },
    unmatchedColumns: { type: [String], default: [] },
    missingRequired: { type: [String], default: [] },
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
  },
  {
    timestamps: true,
    strict: true,
  },
);

ImportedDatasetSchema.index({ branchId: 1, datasetType: 1, createdAt: -1 });

export const ImportedDatasetModel = mongoose.model<IImportedDataset>(
  "ImportedDataset",
  ImportedDatasetSchema,
);
