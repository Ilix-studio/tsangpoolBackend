import mongoose, { Document, Schema } from "mongoose";
import { UserRole, ROLES } from "../../types/user.types";

export interface IAutoRegistrationSummary {
  vehicleMatchedServiceUpdated: number;
  customersRepaired: number;
  customerCreatedVehicleCreated: number;
  customerMatchedVehicleCreated: number;
  conflicts: number;
  skipped: number;
  freeServicesDisabled: number;
  nameMismatches: number;
}

/**
 * ServiceJobcardBatch — one document per service-jobcard upload, holding the
 * upload-over-upload comparison summary (added/changed counts, revenue
 * before/after, the rendered changelog, and the customer/vehicle
 * auto-registration summary). The rows themselves live in
 * ServiceJobcardRecord, referencing this document via `batchId`.
 */
export interface IServiceJobcardBatch extends Document {
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
  deletedBy?: mongoose.Types.ObjectId;
  deletedByRole?: UserRole;
  deletedAt?: Date;

  previousBatchId?: string | null;
  addedRows: number;
  changedRows: number;
  unchangedRows: number;
  revenueBefore: number;
  revenueAfter: number;
  revenueDelta: number;
  changesMarkdown: string;
  autoRegistration: IAutoRegistrationSummary;

  createdAt: Date;
  updatedAt: Date;
}

const AutoRegistrationSummarySchema = new Schema<IAutoRegistrationSummary>(
  {
    vehicleMatchedServiceUpdated: { type: Number, default: 0 },
    customersRepaired: { type: Number, default: 0 },
    customerCreatedVehicleCreated: { type: Number, default: 0 },
    customerMatchedVehicleCreated: { type: Number, default: 0 },
    conflicts: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    freeServicesDisabled: { type: Number, default: 0 },
    nameMismatches: { type: Number, default: 0 },
  },
  { _id: false },
);

const ServiceJobcardBatchSchema = new Schema<IServiceJobcardBatch>(
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
    deletedBy: { type: Schema.Types.ObjectId },
    deletedByRole: { type: String, enum: Object.values(ROLES) },
    deletedAt: { type: Date },

    previousBatchId: { type: String, default: null },
    addedRows: { type: Number, default: 0 },
    changedRows: { type: Number, default: 0 },
    unchangedRows: { type: Number, default: 0 },
    revenueBefore: { type: Number, default: 0 },
    revenueAfter: { type: Number, default: 0 },
    revenueDelta: { type: Number, default: 0 },
    changesMarkdown: { type: String, default: "" },
    autoRegistration: { type: AutoRegistrationSummarySchema, default: () => ({}) },
  },
  {
    timestamps: true,
    strict: true,
  },
);

ServiceJobcardBatchSchema.index({ branchId: 1, createdAt: -1 });

export const ServiceJobcardBatchModel = mongoose.model<IServiceJobcardBatch>(
  "ServiceJobcardBatch",
  ServiceJobcardBatchSchema,
);
