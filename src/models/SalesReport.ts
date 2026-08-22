import mongoose, { Document, Schema } from "mongoose";
import { UserRole } from "../types/user.types";

/**
 * SalesReport — one row extracted from a Branch-Admin-uploaded CSV/XLSX of
 * already-sold vehicles. Every source column is preserved in `rowData`; the
 * curated fields (model/customer/frame/engine/purchase details) are lifted
 * onto typed top-level fields for querying/sorting/summing.
 *
 * Each row is matched against StockConceptCSV by Frame No OR Engine No (see
 * service/salesReport/processSalesReportRow.service.ts). Frame No is the
 * genuine business key for THIS report's own de-duplication (mirrors
 * CounterSaleReport's cpotcOrderNumber pattern) — Engine No is only a
 * secondary lookup key for the StockConceptCSV match, not this dedup index.
 */
export interface ISalesReport extends Document {
  saleReportId: string;
  rowData: Record<string, any>;
  detectedColumns: string[];
  sourceFormat: "xlsx" | "csv";

  // Curated fields extracted from the CSV
  modelName: string;
  modelVariant: string;
  customerFirstName: string;
  customerLastName: string;
  customerMobile: string;
  frameNo: string;
  engineNo: string;
  status: string; // fixed literal "Sold", not CSV-extracted
  purchaseType: string;
  totalPayment: number;

  // Row-processing outcome (see processSalesReportRow.service.ts)
  matchOutcome:
    | "matched_status_flipped"
    | "matched_manual_form_status_flipped"
    | "matched_already_sold"
    | "unmatched"
    | "customer_conflict";
  matched: boolean;
  needsReview: boolean;
  matchedStockId?: mongoose.Types.ObjectId;
  // Which collection matchedStockId refers to — undefined/omitted on rows
  // written before this field existed means "StockConceptCSV" (the only
  // collection matched at the time).
  matchedStockType?: "StockConceptCSV" | "StockConcept";
  customerId?: mongoose.Types.ObjectId;
  customerVehicleId?: mongoose.Types.ObjectId;

  // Batch/import metadata
  importBatch: string;
  importDate: Date;
  fileName: string;
  branchId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  isActive: boolean;

  // Soft-delete audit
  deletedBy?: mongoose.Types.ObjectId;
  deletedByRole?: UserRole;
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const SalesReportSchema = new Schema<ISalesReport>(
  {
    saleReportId: {
      type: String,
      required: true,
      unique: true,
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
    modelName: {
      type: String,
      default: "",
    },
    modelVariant: {
      type: String,
      default: "",
    },
    customerFirstName: {
      type: String,
      default: "",
    },
    customerLastName: {
      type: String,
      default: "",
    },
    customerMobile: {
      type: String,
      default: "",
    },
    frameNo: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    engineNo: {
      type: String,
      default: "",
      uppercase: true,
      index: true,
    },
    status: {
      type: String,
      default: "Sold",
    },
    purchaseType: {
      type: String,
      default: "",
    },
    totalPayment: {
      type: Number,
      default: 0,
    },
    matchOutcome: {
      type: String,
      enum: [
        "matched_status_flipped",
        "matched_manual_form_status_flipped",
        "matched_already_sold",
        "unmatched",
        "customer_conflict",
      ],
      required: true,
      index: true,
    },
    matched: {
      type: Boolean,
      default: false,
      index: true,
    },
    needsReview: {
      type: Boolean,
      default: false,
      index: true,
    },
    matchedStockId: {
      type: Schema.Types.ObjectId,
      // Refers to either StockConceptCSV or StockConcept — see matchedStockType.
      refPath: "matchedStockType",
    },
    matchedStockType: {
      type: String,
      enum: ["StockConceptCSV", "StockConcept"],
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "BaseCustomer",
    },
    customerVehicleId: {
      type: Schema.Types.ObjectId,
      ref: "CustomerVehicle",
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

// Dedup key: same Frame No within the same branch. Scoped to active rows so
// a soft-deleted batch's frame numbers can be re-imported without colliding
// with their own (now inactive) copies. Mirrors CounterSaleReport's
// {branchId, cpotcOrderNumber} pattern.
SalesReportSchema.index(
  { branchId: 1, frameNo: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

export const SalesReportModel = mongoose.model<ISalesReport>(
  "SalesReport",
  SalesReportSchema,
);
