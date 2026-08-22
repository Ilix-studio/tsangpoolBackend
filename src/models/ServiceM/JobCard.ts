import mongoose, { Document, Schema } from "mongoose";
import {
  IJobCard,
  ILineItem,
  IBillVersion,
  IConfirmation,
  IPhysicalChecklist,
  JOB_CARD_STATUSES,
  LINE_ITEM_TYPES,
  PRIORITY_LEVELS,
  VEHICLE_CONDITIONS,
} from "../../types/jobCard.types";

export interface IJobCardDocument extends IJobCard, Document {
  recalculateTotals(): void;
  snapshotBill(
    sentBy: mongoose.Types.ObjectId,
    billType: "temp" | "final",
  ): void;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const lineItemSchema = new Schema<ILineItem>(
  {
    catalogRef: {
      type: Schema.Types.ObjectId,
      ref: "JobCardCatalogItem",
      default: null,
    },
    itemType: {
      type: String,
      enum: LINE_ITEM_TYPES,
      required: [true, "Item type is required"],
    },
    name: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
      maxlength: [200, "Item name cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price is required"],
      min: [0, "Unit price cannot be negative"],
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, "Discount cannot be negative"],
      max: [100, "Discount cannot exceed 100%"],
    },
    taxRate: {
      type: Number,
      default: 18,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
    },
    lineTotal: {
      type: Number,
      default: 0,
      min: [0, "Line total cannot be negative"],
    },
    addedBy: {
      type: String,
      enum: ["service_admin", "customer"],
      required: true,
    },
    isRemoved: {
      type: Boolean,
      default: false,
    },
    removedBy: {
      type: String,
      enum: ["customer", "service_admin"],
    },
  },
  { _id: true },
);

const billVersionSchema = new Schema<IBillVersion>(
  {
    version: { type: Number, required: true },
    sentAt: { type: Date, required: true },
    sentBy: { type: Schema.Types.ObjectId, required: true },
    billType: { type: String, enum: ["temp", "final"], required: true },
    lineItemsSnapshot: { type: [lineItemSchema], default: [] },
    subtotal: { type: Number, required: true },
    taxTotal: { type: Number, required: true },
    grandTotal: { type: Number, required: true },
  },
  { _id: false },
);

const confirmationSchema = new Schema<IConfirmation>(
  {
    method: {
      type: String,
      enum: ["otp", "button", null],
      default: null,
    },
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
    confirmedAt: { type: Date },
    confirmedVia: {
      type: String,
      enum: ["otp", "button", null],
      default: null,
    },
  },
  { _id: false },
);

const physicalChecklistSchema = new Schema<IPhysicalChecklist>(
  {
    fuelLevel: {
      type: Number,
      min: [0, "Fuel level cannot be negative"],
      max: [100, "Fuel level cannot exceed 100"],
    },
    vehicleCondition: { type: String, enum: VEHICLE_CONDITIONS },
    paintCondition: { type: String, trim: true, maxlength: 200 },
    remarks: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const jobCardSchema = new Schema<IJobCardDocument>(
  {
    jobCardNumber: {
      type: String,
      unique: true,
      index: true,
    },
    serviceBooking: {
      type: Schema.Types.ObjectId,
      ref: "ServiceBooking",
      default: null,
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
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch is required"],
      index: true,
    },
    openedBy: {
      type: Schema.Types.ObjectId,
      ref: "ServiceAdmin",
      required: [true, "Opened by is required"],
    },
    assignedTechnician: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    status: {
      type: String,
      enum: JOB_CARD_STATUSES,
      default: "draft",
      index: true,
    },
    priority: {
      type: String,
      enum: PRIORITY_LEVELS,
      default: "normal",
    },
    serviceType: {
      type: String,
      required: [true, "Service type is required"],
      trim: true,
    },
    physicalChecklist: {
      type: physicalChecklistSchema,
      default: () => ({}),
    },
    customerRequests: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    // Never returned in customer-facing responses — filtered in controller
    internalNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    lineItems: {
      type: [lineItemSchema],
      default: [],
    },
    subtotal: { type: Number, default: 0, min: 0 },
    taxTotal: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    billVersions: {
      type: [billVersionSchema],
      default: [],
    },
    confirmation: {
      type: confirmationSchema,
      default: () => ({
        method: null,
        otpAttempts: 0,
        confirmedVia: null,
      }),
    },
    invoiceRef: {
      type: Schema.Types.ObjectId,
      ref: "JobCardInvoice",
    },
    tempBillSentAt: { type: Date },
    customerReviewedAt: { type: Date },
    inProgressAt: { type: Date },
    finalBillSentAt: { type: Date },
    closedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

jobCardSchema.index({ branch: 1, status: 1 });
jobCardSchema.index({ customer: 1, status: 1 });
jobCardSchema.index({ branch: 1, createdAt: -1 });

// ─── Pre-save: generate job card number ──────────────────────────────────────

jobCardSchema.pre("save", async function (next) {
  if (this.isNew && !this.jobCardNumber) {
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
    const count = await mongoose.model("JobCard").countDocuments({
      createdAt: { $gte: startOfDay, $lt: endOfDay },
    });
    this.jobCardNumber = `JC-${dateStr}-${String(count + 1).padStart(4, "0")}`;
  }
  next();
});

// ─── Pre-save: recompute totals whenever lineItems are modified ───────────────

jobCardSchema.pre("save", function (next) {
  if (this.isModified("lineItems")) {
    this.recalculateTotals();
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

/**
 * Recomputes lineTotal for every item and rolls up aggregate totals.
 * Removed items contribute 0 to totals but remain in the array for audit.
 *
 * Per active item:
 *   preTax    = qty * unitPrice * (1 - discount/100)
 *   tax       = preTax * (taxRate/100)
 *   lineTotal = preTax + tax
 */
jobCardSchema.methods.recalculateTotals = function (
  this: IJobCardDocument,
): void {
  let subtotal = 0;
  let taxTotal = 0;

  for (const item of this.lineItems) {
    if (item.isRemoved) {
      item.lineTotal = 0;
      continue;
    }
    const preTax = item.quantity * item.unitPrice * (1 - item.discount / 100);
    const tax = preTax * (item.taxRate / 100);
    item.lineTotal = parseFloat((preTax + tax).toFixed(2));
    subtotal += preTax;
    taxTotal += tax;
  }

  this.subtotal = parseFloat(subtotal.toFixed(2));
  this.taxTotal = parseFloat(taxTotal.toFixed(2));
  this.grandTotal = parseFloat((subtotal + taxTotal).toFixed(2));
};

/**
 * Snapshots active line items into billVersions before a bill send.
 * Must be called before status update, before save().
 */
jobCardSchema.methods.snapshotBill = function (
  this: IJobCardDocument,
  sentBy: mongoose.Types.ObjectId,
  billType: "temp" | "final",
): void {
  const activeItems = this.lineItems.filter((item) => !item.isRemoved);
  const nextVersion = this.billVersions.length + 1;

  this.billVersions.push({
    version: nextVersion,
    sentAt: new Date(),
    sentBy,
    billType,
    lineItemsSnapshot: activeItems,
    subtotal: this.subtotal,
    taxTotal: this.taxTotal,
    grandTotal: this.grandTotal,
  });
};

export const JobCardModel = mongoose.model<IJobCardDocument>(
  "JobCard",
  jobCardSchema,
);
