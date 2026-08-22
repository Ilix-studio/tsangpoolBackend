// models/BikeSystemModel2/B2BSalesModel.ts
import mongoose, { Document, Schema } from "mongoose";
import Branch from "../Branch";
import { nextSeq } from "../Counter";
import { numberToLetters } from "../../utils/spreadsheetLetters";

// Golaghat's letterhead — also the fallback for any branch without its own
// confirmed address (currently: Telgaram, TODO once its real address/phone
// is provided).
export const DEFAULT_B2B_SALES_HEADING =
  "TSANGPOOL HONDA\nG. F. ROAD, BENGENAKHOWA, GOLAGHAT\nPh. 9401453344, 9401553344";

const SARUPATHAR_HEADING =
  "TSANGPOOL HONDA\nSarupathar, GOLAGHAT\nPh. 9401453322, 9401553322";

/**
 * Per-branch challan letterhead — see also client/src/mainComponents/B2BSalesM/
 * branchLetterhead.ts (same mapping, duplicated: separate runtime, can't
 * share a module).
 */
export function getBranchLetterhead(branchName: string): string {
  if (branchName.toLowerCase().includes("sarupathar")) return SARUPATHAR_HEADING;
  return DEFAULT_B2B_SALES_HEADING;
}

export interface IB2BStockItem {
  stockConceptCSVId: mongoose.Types.ObjectId;
  modelName: string;
  engineNumber: string;
  chassisNumber: string;
  costPrice: number;
  quantity: number;
  totalPrice: number;
  // Set only when this challan's own create/update flow found a matching
  // Manual-form (StockConceptModel) record by engine/chassis number and
  // flipped it to Sold — lets cancel/edit revert exactly that record
  // without touching a StockConcept doc that was independently sold.
  linkedManualStockId?: mongoose.Types.ObjectId;
}

export interface IB2BExtraItem {
  name: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

export interface IB2BSales extends Document {
  challanNo: string;
  date: Date;
  branchId: mongoose.Types.ObjectId;
  from: string;
  to: string;
  topHeading: string;
  stockItems: IB2BStockItem[];
  extraItems: IB2BExtraItem[];
  totalPrice: number;
  tcsAmount?: number;
  payablePrice: number;
  createdBy: mongoose.Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const B2BStockItemSchema = new Schema<IB2BStockItem>(
  {
    stockConceptCSVId: {
      type: Schema.Types.ObjectId,
      ref: "StockConceptCSV",
      required: true,
    },
    modelName: { type: String, required: true },
    engineNumber: { type: String, required: true },
    chassisNumber: { type: String, required: true },
    costPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    // Not `required` — always recomputed server-side in the pre("validate")
    // hook below, before it would otherwise fail required-field validation.
    totalPrice: { type: Number, default: 0, min: 0 },
    linkedManualStockId: {
      type: Schema.Types.ObjectId,
      ref: "StockConcept",
    },
  },
  { _id: false },
);

const B2BExtraItemSchema = new Schema<IB2BExtraItem>(
  {
    name: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const B2BSalesSchema = new Schema<IB2BSales>(
  {
    challanNo: {
      type: String,
      unique: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch is required"],
      index: true,
    },
    from: { type: String, required: true },
    to: { type: String, required: true, trim: true },
    topHeading: {
      type: String,
      required: true,
      default: DEFAULT_B2B_SALES_HEADING,
    },
    stockItems: {
      type: [B2BStockItemSchema],
      default: [],
    },
    extraItems: {
      type: [B2BExtraItemSchema],
      default: [],
    },
    totalPrice: { type: Number, required: true, min: 0, default: 0 },
    // Genuinely optional — no `default: 0` — so "not entered" is
    // distinguishable from "entered 0". A flat amount added to Total Price,
    // not a percentage.
    tcsAmount: { type: Number, min: 0 },
    payablePrice: { type: Number, required: true, min: 0, default: 0 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "BranchManager",
      required: true,
    },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  },
);

B2BSalesSchema.index({ branchId: 1 });
B2BSalesSchema.index({ date: 1 });

function computeLineItemTotals(doc: IB2BSales) {
  doc.stockItems.forEach((item) => {
    item.totalPrice = item.costPrice * item.quantity;
  });
  doc.extraItems.forEach((item) => {
    item.totalPrice = item.unitPrice * item.quantity;
  });

  const stockTotal = doc.stockItems.reduce((sum, i) => sum + i.totalPrice, 0);
  const extraTotal = doc.extraItems.reduce((sum, i) => sum + i.totalPrice, 0);
  doc.totalPrice = Math.round((stockTotal + extraTotal) * 100) / 100;
}

/**
 * Resolves (lazily assigning if missing) the branch's stable letter prefix
 * used for challan numbering. Real branches should already have one from
 * scripts/backfillBranchChallanPrefixes.ts — this is a defensive fallback
 * for a branch created after that backfill ran.
 */
async function resolveBranchChallanPrefix(
  branchId: mongoose.Types.ObjectId,
): Promise<string> {
  const branch = await Branch.findById(branchId);
  if (!branch) {
    throw new Error("Branch not found while generating challan number");
  }
  if (branch.challanPrefix) return branch.challanPrefix;

  const position = await nextSeq("b2b_branch_prefix");
  const prefix = numberToLetters(position);
  branch.challanPrefix = prefix;
  await branch.save();
  return prefix;
}

// ─── Pre-validate: recompute totals server-side before required-field checks ─
// (must run pre-validate, not pre-save — pre-save fires AFTER schema
// validation, which would reject an empty stockItems[].totalPrice first)

B2BSalesSchema.pre("validate", function (next) {
  // Never trust client-submitted line totals — recompute from
  // costPrice/unitPrice * quantity on every create AND update.
  computeLineItemTotals(this);
  next();
});

// ─── Pre-save: generate challanNo ────────────────────────────────────────────

B2BSalesSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.challanNo) {
      const prefix = await resolveBranchChallanPrefix(this.branchId);
      const seq = await nextSeq(`b2b_challan_seq_${this.branchId.toString()}`);
      this.challanNo = `${prefix}${String(seq).padStart(4, "0")}`;
    }

    next();
  } catch (err) {
    next(err as Error);
  }
});

export const B2BSalesModel = mongoose.model<IB2BSales>(
  "B2BSales",
  B2BSalesSchema,
);
