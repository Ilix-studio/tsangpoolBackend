import mongoose, { Document, Schema } from "mongoose";
import crypto from "crypto";
import { IJobCardInvoice, ILineItem } from "../../types/jobCard.types";

export interface IJobCardInvoiceDocument extends IJobCardInvoice, Document {}

// Reuse the same line item shape as JobCard — snapshot only, no subdoc refs
const invoiceLineItemSchema = new Schema<ILineItem>(
  {
    catalogRef: { type: Schema.Types.ObjectId, default: null },
    itemType: {
      type: String,
      enum: ["labour", "part", "accessory", "custom"],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 18 },
    lineTotal: { type: Number, required: true, min: 0 },
    addedBy: {
      type: String,
      enum: ["service_admin", "customer"],
      required: true,
    },
    isRemoved: { type: Boolean, default: false },
    removedBy: { type: String, enum: ["customer", "service_admin"] },
  },
  { _id: false },
);

const jobCardInvoiceSchema = new Schema<IJobCardInvoiceDocument>(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      index: true,
    },
    jobCard: {
      type: Schema.Types.ObjectId,
      ref: "JobCard",
      required: [true, "Job card reference is required"],
      index: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch is required"],
      index: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "BaseCustomer",
      required: [true, "Customer is required"],
      index: true,
    },
    vehicle: {
      type: Schema.Types.ObjectId,
      ref: "CustomerVehicle",
      required: [true, "Vehicle is required"],
    },
    // Immutable at creation — never updated after invoice is issued
    lineItemsSnapshot: {
      type: [invoiceLineItemSchema],
      required: true,
    },
    subtotal: { type: Number, required: true, min: 0 },
    taxTotal: { type: Number, required: true, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    // Nullable until async Cloudinary PDF upload completes
    pdfUrl: { type: String, default: null },
    // SHA-256(invoiceId + confirmedAt.toISOString() + customerId)
    // Generated server-side at invoice creation; used for tamper detection
    digitalSignatureToken: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    notifiedSuperAdmin: { type: Boolean, default: false },
    notifiedServiceAdmin: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

// ─── Pre-save: generate invoice number ───────────────────────────────────────

jobCardInvoiceSchema.pre("save", async function (next) {
  if (this.isNew && !this.invoiceNumber) {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const startOfDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const endOfDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    );
    const count = await mongoose.model("JobCardInvoice").countDocuments({
      createdAt: { $gte: startOfDay, $lt: endOfDay },
    });
    this.invoiceNumber = `INV-${dateStr}-${String(count + 1).padStart(4, "0")}`;
  }
  next();
});

// ─── Static: generate digital signature token ────────────────────────────────

jobCardInvoiceSchema.statics.generateSignatureToken = function (
  invoiceId: string,
  confirmedAt: Date,
  customerId: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${invoiceId}:${confirmedAt.toISOString()}:${customerId}`)
    .digest("hex");
};

export const JobCardInvoiceModel = mongoose.model<IJobCardInvoiceDocument>(
  "JobCardInvoice",
  jobCardInvoiceSchema,
);
