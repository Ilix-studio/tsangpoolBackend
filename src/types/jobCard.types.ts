import mongoose from "mongoose";

// ─── Enums / Literal Unions ───────────────────────────────────────────────────

export const JOB_CARD_STATUSES = [
  "draft",
  "temp_bill_sent",
  "customer_reviewed",
  "in_progress",
  "final_bill_sent",
  "customer_confirmed",
  "invoice_generated",
  "closed",
  "cancelled",
] as const;

export type JobCardStatus = (typeof JOB_CARD_STATUSES)[number];

export const LINE_ITEM_TYPES = [
  "labour",
  "part",
  "accessory",
  "custom",
] as const;

export type LineItemType = (typeof LINE_ITEM_TYPES)[number];

export const BILL_TYPES = ["temp", "final"] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const CONFIRMATION_METHODS = ["otp", "button"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export const PRIORITY_LEVELS = ["normal", "urgent"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const VEHICLE_CONDITIONS = ["good", "fair", "poor", "damaged"] as const;
export type VehicleCondition = (typeof VEHICLE_CONDITIONS)[number];

// ─── Line Item ────────────────────────────────────────────────────────────────

export interface ILineItem {
  _id?: mongoose.Types.ObjectId;
  // null for free-text custom items
  catalogRef: mongoose.Types.ObjectId | null;
  itemType: LineItemType;
  // Snapshot of name at time of addition — not linked live to catalog
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  // Percentage, 0–100
  discount: number;
  // Percentage, default 18 (GST)
  taxRate: number;
  // Computed server-side: qty * unitPrice * (1 - discount/100) * (1 + taxRate/100)
  lineTotal: number;
  addedBy: "service_admin" | "customer";
  isRemoved: boolean;
  removedBy?: "customer" | "service_admin";
}

// ─── Bill Version Snapshot ────────────────────────────────────────────────────

export interface IBillVersion {
  version: number;
  sentAt: Date;
  sentBy: mongoose.Types.ObjectId;
  billType: BillType;
  // Immutable snapshot of active line items at send time
  lineItemsSnapshot: ILineItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
}

// ─── Confirmation State ───────────────────────────────────────────────────────

export interface IConfirmation {
  method: ConfirmationMethod | null;
  // bcrypt hash of the 6-digit OTP — raw OTP never stored
  otpHash?: string;
  otpExpiresAt?: Date;
  // Max 3 attempts before requiring new OTP
  otpAttempts: number;
  confirmedAt?: Date;
  confirmedVia: ConfirmationMethod | null;
}

// ─── Physical Checklist (mirrors the job card form) ──────────────────────────

export interface IPhysicalChecklist {
  fuelLevel?: number; // 0–100 percentage
  vehicleCondition?: VehicleCondition;
  paintCondition?: string;
  // Free-text notes from SA on vehicle arrival state
  remarks?: string;
}

// ─── Job Card Document Interface ──────────────────────────────────────────────

export interface IJobCard {
  jobCardNumber: string; // JC-YYYYMMDD-NNNN
  // Optional — null for walk-in customers
  serviceBooking: mongoose.Types.ObjectId | null;
  customer: mongoose.Types.ObjectId;
  vehicle: mongoose.Types.ObjectId;
  branch: mongoose.Types.ObjectId;
  // The SA who opened the job card
  openedBy: mongoose.Types.ObjectId;
  // Technician assigned (name or SA ObjectId)
  assignedTechnician?: string;
  status: JobCardStatus;
  priority: PriorityLevel;
  // Type of service from the job card form (mirrors ServiceBooking.serviceType)
  serviceType: string;
  // Physical inspection data captured on vehicle arrival
  physicalChecklist: IPhysicalChecklist;
  // Customer requests captured verbally at the counter
  customerRequests?: string;
  // SA internal notes — never visible to customer
  internalNotes?: string;
  // All line items (active and soft-removed)
  lineItems: ILineItem[];
  // Computed totals across all active (non-removed) line items
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  // Append-only bill history for audit trail
  billVersions: IBillVersion[];
  confirmation: IConfirmation;
  // Set when invoice is generated
  invoiceRef?: mongoose.Types.ObjectId;
  // Timestamps for state transitions
  tempBillSentAt?: Date;
  customerReviewedAt?: Date;
  inProgressAt?: Date;
  finalBillSentAt?: Date;
  closedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Job Card Catalog Item Interface ─────────────────────────────────────────

export interface IJobCardCatalogItem {
  branch: mongoose.Types.ObjectId;
  itemType: LineItemType;
  name: string;
  description?: string;
  defaultUnitPrice: number;
  // Default tax rate applied when this item is added to a job card
  defaultTaxRate: number;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Invoice Interface ────────────────────────────────────────────────────────

export interface IJobCardInvoice {
  invoiceNumber: string; // INV-YYYYMMDD-NNNN
  jobCard: mongoose.Types.ObjectId;
  branch: mongoose.Types.ObjectId;
  customer: mongoose.Types.ObjectId;
  vehicle: mongoose.Types.ObjectId;
  // Immutable snapshot — never reads from JobCard after generation
  lineItemsSnapshot: ILineItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  // Cloudinary URL — nullable until async PDF upload completes
  pdfUrl: string | null;
  // SHA-256(invoiceId + confirmedAt.toISOString() + customerId) — tamper-evident
  digitalSignatureToken: string;
  issuedAt: Date;
  // Notification tracking for Super-Admin and Service-Admin records
  notifiedSuperAdmin: boolean;
  notifiedServiceAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Request Body Types ───────────────────────────────────────────────────────

export interface CreateJobCardBody {
  // Provide either serviceBookingId (preferred) or customerId for walk-ins
  serviceBookingId?: string;
  customerId?: string;
  vehicleId?: string;
  priority?: PriorityLevel;
  assignedTechnician?: string;
  physicalChecklist?: Partial<IPhysicalChecklist>;
  customerRequests?: string;
  internalNotes?: string;
}

export interface AddLineItemBody {
  // Provide catalogRef for catalog items, omit for custom free-text
  catalogRef?: string;
  itemType: LineItemType;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export interface RemoveLineItemBody {
  lineItemId: string;
  removedBy: "customer" | "service_admin";
}

export interface CustomerReviewBody {
  // Customer can only remove items, not add — additions stay with SA
  removedLineItemIds: string[];
  // Customer can add free-text requests back as notes
  additionalRequests?: string;
}

export interface SendFinalBillBody {
  internalNotes?: string;
}

export interface CancelJobCardBody {
  cancellationReason: string;
}

export interface CreateCatalogItemBody {
  itemType: LineItemType;
  name: string;
  description?: string;
  defaultUnitPrice: number;
  defaultTaxRate?: number;
}

export interface UpdateCatalogItemBody {
  name?: string;
  description?: string;
  defaultUnitPrice?: number;
  defaultTaxRate?: number;
  isActive?: boolean;
}

// ─── Query Filter Types ───────────────────────────────────────────────────────

export interface JobCardQueryFilters {
  status?: JobCardStatus;
  branchId?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  priority?: PriorityLevel;
  page?: number;
  limit?: number;
}
