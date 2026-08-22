import mongoose, { Document, Schema } from "mongoose";
import { UserRole } from "../types/user.types";

/**
 * CounterSaleReport — one row extracted from an uploaded Counter Sale Report
 * (channel-partner XLSX/CSV export). Every source column is preserved in
 * `rowData`; the four columns staff actually work with day-to-day are also
 * lifted onto typed top-level fields (organization/accountName/
 * purchaseOrderDate/totalInvoice) so they can be queried/sorted/summed
 * without reaching into the Mixed blob.
 *
 * Unlike PartsReport's content-hash dedup, "CPOTC Order #" is a genuine
 * business key from the source system, so de-duplication uses it directly
 * (scoped per branch via a compound unique index).
 */
export interface ICounterSaleReport extends Document {
  saleId: string;
  cpotcOrderNumber: string;
  rowData: Record<string, any>;
  detectedColumns: string[];
  sourceFormat: "xlsx" | "csv";

  // Curated display fields
  organization: string;
  accountName: string;
  purchaseOrderDate: Date | null;
  totalInvoice: number;

  // Batch/import metadata
  importBatch: string;
  importDate: Date;
  fileName: string;
  branchId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  needsReview: boolean;
  isActive: boolean;

  // Soft-delete audit
  deletedBy?: mongoose.Types.ObjectId;
  deletedByRole?: UserRole;
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const CounterSaleReportSchema = new Schema<ICounterSaleReport>(
  {
    saleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    cpotcOrderNumber: {
      type: String,
      required: true,
      index: true,
    },
    rowData: {
      type: Schema.Types.Mixed,
      required: true,
    },
    detectedColumns: {
      type: [String],
      default: [],
    },
    sourceFormat: {
      type: String,
      enum: ["xlsx", "csv"],
      required: true,
    },
    organization: {
      type: String,
      default: "",
    },
    accountName: {
      type: String,
      default: "",
    },
    purchaseOrderDate: {
      type: Date,
      default: null,
    },
    totalInvoice: {
      type: Number,
      default: 0,
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
    deletedBy: {
      type: Schema.Types.ObjectId,
    },
    deletedByRole: {
      type: String,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    strict: false, // preserve arbitrary source columns beyond the defined ones
  },
);

// Dedup key: same channel-partner order number within the same branch.
// Scoped to active rows so a soft-deleted batch's order numbers can be
// re-imported without colliding with their own (now inactive) copies.
CounterSaleReportSchema.index(
  { branchId: 1, cpotcOrderNumber: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

export const CounterSaleReportModel = mongoose.model<ICounterSaleReport>(
  "CounterSaleReport",
  CounterSaleReportSchema,
);
