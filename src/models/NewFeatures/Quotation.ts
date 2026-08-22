// models/NewFeatures/Quotation.ts
import crypto from "crypto";
import mongoose, { Document, Schema } from "mongoose";
import { nextSeq } from "../Counter";

export type QuotationCreatorModel = "BranchManager" | "Staff";
export type QuotationPricingType = "standard" | "variation";

export interface IQuotationBikeSnapshot {
  modelName: string;
  category: string;
  mainCategory: "bike" | "scooter";
  image?: { src: string; alt: string };
}

export interface IQuotationVariation {
  label: string;
  price: number;
  onRoadPrice: number;
}

export interface IQuotationInsurance {
  provider?: string;
  premium?: number;
  notes?: string;
}

export interface IQuotationVasSelection {
  vas: mongoose.Types.ObjectId;
  serviceName: string;
  price: number;
}

export interface IQuotationTo {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
}

export interface IQuotationAccessory {
  name: string;
  quantity: number;
  amount: number;
}

// Same dealership letterhead used by the B2B Sales challan — duplicated
// (not shared) since that's this codebase's convention for per-module
// letterhead text; see B2BSalesModel.ts's identical constants.
export const DEFAULT_QUOTATION_HEADING =
  "TSANGPOOL HONDA\nG. F. ROAD, BENGENAKHOWA, GOLAGHAT\nPh. 9401453344, 9401553344";

const SARUPATHAR_QUOTATION_HEADING =
  "TSANGPOOL HONDA\nSarupathar, GOLAGHAT\nPh. 9401453322, 9401553322";

export function getQuotationLetterhead(branchName?: string): string {
  if (branchName?.toLowerCase().includes("sarupathar")) return SARUPATHAR_QUOTATION_HEADING;
  return DEFAULT_QUOTATION_HEADING;
}

export const DEFAULT_QUOTATION_BANK_DETAILS =
  "Bank Details- HDFC BANK, GOLAGHAT BRANCH\n" +
  "A/c No-50200028753554\n" +
  "IFSC-HDFC0002937\n" +
  "TSANGPOOL HONDA\n" +
  "GSTIN/UIN-18AJNPP5932A4Z1";

export const DEFAULT_QUOTATION_TERMS =
  "Terms & Conditions:\n" +
  "1. Above rates are inclusive of Local Sales Tax prevailing at the time of delivery will be applicable.\n" +
  "2. DD/ Cheque/ Pay Order should be drawn in favor of (Dealer Name: Biswajit Phukan)\n" +
  "3. Kindly bring proof of residence for registration.\n" +
  "4. Prices quoted in the quotation are as per HMSI Guidelines. It may change as per HMSI.\n" +
  "5. Valid from (*Conditions Apply)";

export interface IQuotation extends Document {
  quotationNo: string;
  publicToken: string;

  bike: mongoose.Types.ObjectId;
  bikeSnapshot: IQuotationBikeSnapshot;

  pricingType: QuotationPricingType;

  // Used when pricingType === "standard" — pre-filled from the bike's
  // priceBreakdown at selection time, then independently editable/stored here.
  exShowroomPrice: number;
  onRoadTax: number;

  // Used when pricingType === "variation" — fully freeform.
  variation?: IQuotationVariation;

  // Computed pre-validate: exShowroomPrice + onRoadTax (standard), or
  // variation.onRoadPrice (variation) — never trusted from the client.
  onRoadPrice?: number;

  insurance?: IQuotationInsurance;

  vasSelections: IQuotationVasSelection[];
  accessories: IQuotationAccessory[];

  to: IQuotationTo;

  topHeading: string;
  bankDetails: string;
  termsAndConditions: string;

  // Manually triggered by a Branch-Admin/Staff (see markQuotationExpired in
  // quotation_controller.ts) when the bike's ex-showroom price has risen
  // since this quotation was issued — the public link then shows an expired
  // notice instead of the now-stale price.
  isExpired: boolean;
  expiredAt?: Date;
  expiredReason?: string;

  createdBy: mongoose.Types.ObjectId;
  createdByModel: QuotationCreatorModel;
  createdByRole: "Branch-Admin" | "Staff";
  branch: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const QuotationSchema = new Schema<IQuotation>(
  {
    quotationNo: {
      type: String,
      unique: true,
      index: true,
    },
    // Not `required` — always set in the pre("save") hook below (same
    // reason quotationNo isn't required: it doesn't exist until then, and
    // schema validation runs before pre("save") fires).
    publicToken: {
      type: String,
    },

    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bikes",
      required: true,
    },
    bikeSnapshot: {
      modelName: { type: String, required: true, trim: true },
      category: { type: String, required: true },
      mainCategory: { type: String, enum: ["bike", "scooter"], required: true },
      image: {
        src: String,
        alt: String,
      },
    },

    pricingType: {
      type: String,
      enum: ["standard", "variation"],
      default: "standard",
      required: true,
    },

    exShowroomPrice: {
      type: Number,
      required: true,
      min: [0, "Ex-showroom price must be positive"],
    },
    onRoadTax: {
      type: Number,
      required: true,
      min: [0, "On-road tax must be positive"],
    },

    variation: {
      label: { type: String, trim: true },
      price: { type: Number, min: 0 },
      onRoadPrice: { type: Number, min: 0 },
    },

    // Computed in the pre("validate") hook below — never accepted from the
    // client.
    onRoadPrice: { type: Number, min: 0 },

    insurance: {
      provider: { type: String, trim: true },
      premium: { type: Number, min: 0 },
      notes: { type: String, trim: true, maxlength: 300 },
    },

    vasSelections: [
      {
        vas: { type: Schema.Types.ObjectId, ref: "ValueAddedService" },
        serviceName: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
      },
    ],

    accessories: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          quantity: { type: Number, required: true, min: 1 },
          amount: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },

    to: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      addressLine1: { type: String, required: true, trim: true },
      addressLine2: { type: String, trim: true },
    },

    topHeading: {
      type: String,
      required: true,
      default: DEFAULT_QUOTATION_HEADING,
    },
    bankDetails: {
      type: String,
      required: true,
      default: DEFAULT_QUOTATION_BANK_DETAILS,
    },
    termsAndConditions: {
      type: String,
      required: true,
      default: DEFAULT_QUOTATION_TERMS,
    },

    isExpired: {
      type: Boolean,
      default: false,
    },
    expiredAt: {
      type: Date,
    },
    expiredReason: {
      type: String,
      trim: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "createdByModel",
    },
    createdByModel: {
      type: String,
      required: true,
      enum: ["BranchManager", "Staff"],
    },
    createdByRole: {
      type: String,
      required: true,
      enum: ["Branch-Admin", "Staff"],
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
  },
  { timestamps: true },
);

QuotationSchema.index({ branch: 1, createdAt: -1 });
QuotationSchema.index({ createdBy: 1, createdAt: -1 });
// Lookup path for the public (unauthenticated) share link.
QuotationSchema.index({ quotationNo: 1, publicToken: 1 });

// ─── Pre-validate: compute onRoadPrice server-side — never trust the client ──

QuotationSchema.pre("validate", function (next) {
  if (this.pricingType === "standard") {
    if (this.exShowroomPrice != null && this.onRoadTax != null) {
      this.onRoadPrice = this.exShowroomPrice + this.onRoadTax;
    }
  } else if (this.pricingType === "variation") {
    if (this.variation?.onRoadPrice != null) {
      this.onRoadPrice = this.variation.onRoadPrice;
    }
  }
  next();
});

// ─── Pre-save: generate quotationNo + publicToken ────────────────────────────

QuotationSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.quotationNo) {
      const seq = await nextSeq("quotation_seq");
      this.quotationNo = `TH${String(seq).padStart(3, "0")}`;
    }
    if (this.isNew && !this.publicToken) {
      this.publicToken = crypto.randomBytes(4).toString("hex");
    }

    next();
  } catch (err) {
    next(err as Error);
  }
});

export default mongoose.model<IQuotation>("Quotation", QuotationSchema);
