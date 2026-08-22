import mongoose, { Document, Schema } from "mongoose";
import { ServiceJobcardNormalizedRow } from "../../utils/serviceJobcardColumnMatcher";

/**
 * ServiceJobcardRecord — one row extracted from an uploaded service-jobcard
 * report (XLSX). Every source column is preserved in `rowData`
 * (`strict: false`); `normalized` holds the canonical, type-coerced fields
 * used for diffing, revenue aggregation, and display — see
 * utils/serviceJobcardColumnMatcher.ts and
 * service/ServiceJobcard/serviceJobcardDiff.service.ts.
 *
 * Persistence is diff-based, keyed by Job Card Number: each upload is
 * compared against the current snapshot (rows with `isCurrent: true`), and
 * only genuinely new/changed rows are inserted. Unlike parts-stock, there is
 * no "removed" bucket — a job-card export is a period's newly-closed cards,
 * not a full historical re-export, so a card's absence from a later upload
 * carries no meaning. `isCurrent` is distinct from `isActive` (a batch-level
 * soft-delete flag) — a corrected job card flips its old row to
 * `isCurrent: false` but it's never deleted, so batch history stays intact.
 *
 * `nameVerification` records whether the phone-matched customer's combined
 * name (firstName + middleName + lastName) reasonably matches this row's
 * free-text Customer Name — a review flag, not a gate on auto-registration
 * (which stays phone-based). See service/ServiceJobcard/autoRegisterCustomer.service.ts.
 */
export interface IServiceJobcardRecord extends Document {
  recordId: string;
  rowData: Record<string, any>;
  normalized: ServiceJobcardNormalizedRow;
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
  nameVerification: "match" | "mismatch" | "unverified";
  createdAt: Date;
  updatedAt: Date;
}

const ServiceJobcardRecordSchema = new Schema<IServiceJobcardRecord>(
  {
    recordId: {
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
    nameVerification: {
      type: String,
      enum: ["match", "mismatch", "unverified"],
      default: "unverified",
    },
  },
  {
    timestamps: true,
    strict: false, // preserve arbitrary source columns beyond the defined ones
  },
);

// At most one "current" row per Job Card Number per branch — enforced at the
// DB level. Not unique across all rows (only where isCurrent: true), so a
// job card's value reverting to a previously-seen exact value in a later
// upload never collides with its own (now superseded) history.
ServiceJobcardRecordSchema.index(
  { branchId: 1, "normalized.jobCardNumber": 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);
ServiceJobcardRecordSchema.index({ branchId: 1, "normalized.frameNumber": 1 });

export const ServiceJobcardRecordModel = mongoose.model<IServiceJobcardRecord>(
  "ServiceJobcardRecord",
  ServiceJobcardRecordSchema,
);
