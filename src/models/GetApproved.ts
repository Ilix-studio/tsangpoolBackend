import mongoose, { Document, Schema } from "mongoose";

// Define the interface for GetApproved document with bike information
export interface IGetApprovedDocument extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentType:
    | "salaried"
    | "self-employed"
    | "business-owner"
    | "retired"
    | "student";
  monthlyIncome: number;
  creditScoreRange: "excellent" | "good" | "fair" | "poor";
  applicationId: string; // Auto-generated unique ID
  status: "pending" | "under-review" | "pre-approved" | "approved" | "rejected";
  reviewedBy?: mongoose.Types.ObjectId; // Reference to admin who reviewed
  reviewedAt?: Date;
  reviewNotes?: string;
  preApprovalAmount?: number;
  preApprovalValidUntil?: Date;
  branch?: mongoose.Types.ObjectId; // Reference to branch
  termsAccepted: boolean;
  privacyPolicyAccepted: boolean;

  // NEW: Bike enquiry information
  bikeEnquiry?: {
    bikeId?: mongoose.Types.ObjectId; // Reference to specific bike
    bikeModel?: string; // Manual bike model entry
    category?:
      | "sport"
      | "adventure"
      | "cruiser"
      | "touring"
      | "naked"
      | "electric";
    priceRange?: {
      min: number;
      max: number;
    };
    preferredFeatures?: string[];
    intendedUse?:
      | "daily-commute"
      | "long-touring"
      | "sport-riding"
      | "off-road"
      | "leisure"
      | "business";
    previousBikeExperience?:
      | "first-time"
      | "beginner"
      | "intermediate"
      | "experienced";
    urgency?: "immediate" | "within-month" | "within-3months" | "exploring";
    additionalRequirements?: string;
    tradeInBike?: {
      hasTradeIn: boolean;
      currentBikeModel?: string;
      currentBikeYear?: number;
      estimatedValue?: number;
      condition?: "excellent" | "good" | "fair" | "poor";
    };
  };

  // Enhanced enquiry type
  enquiryType: "general-financing" | "specific-bike" | "trade-in" | "upgrade";

  createdAt: Date;
  updatedAt: Date;

  // Virtual fields
  fullName: string;
  applicationAge: number; // Days since application

  // Instance methods
  generateApplicationId(): string;
  updateStatus(
    newStatus: string,
    reviewerId?: string,
    notes?: string
  ): Promise<IGetApprovedDocument>;
  setPreApproval(
    amount: number,
    validDays?: number
  ): Promise<IGetApprovedDocument>;
  addBikeEnquiry(bikeInfo: any): Promise<IGetApprovedDocument>;
}

// Sub-schema for bike enquiry
const BikeEnquirySchema = new Schema({
  bikeId: {
    type: Schema.Types.ObjectId,
    ref: "Bikes",
  },
  bikeModel: {
    type: String,
    trim: true,
  },
  category: {
    type: String,
    enum: [
      "sport",
      "adventure",
      "cruiser",
      "touring",
      "naked",
      "electric",
      "commuter",
    ],
  },
  priceRange: {
    min: {
      type: Number,
      min: 0,
    },
    max: {
      type: Number,
      min: 0,
    },
  },
  preferredFeatures: [String],
  intendedUse: {
    type: String,
    enum: [
      "daily-commute",
      "long-touring",
      "sport-riding",
      "off-road",
      "leisure",
      "business",
    ],
  },
  previousBikeExperience: {
    type: String,
    enum: ["first-time", "beginner", "intermediate", "experienced"],
  },
  urgency: {
    type: String,
    enum: ["immediate", "within-month", "within-3months", "exploring"],
    default: "exploring",
  },
  additionalRequirements: {
    type: String,
    trim: true,
    maxlength: [500, "Additional requirements cannot exceed 500 characters"],
  },
  tradeInBike: {
    hasTradeIn: {
      type: Boolean,
      default: false,
    },
    currentBikeModel: String,
    currentBikeYear: Number,
    estimatedValue: Number,
    condition: {
      type: String,
      enum: ["excellent", "good", "fair", "poor"],
    },
  },
});

// Sub-schema for trade-in bike
const TradeInBikeSchema = new Schema({
  hasTradeIn: {
    type: Boolean,
    default: false,
  },
  currentBikeModel: {
    type: String,
    trim: true,
  },
  currentBikeYear: {
    type: Number,
    min: 1980,
    max: new Date().getFullYear() + 1,
  },
  estimatedValue: {
    type: Number,
    min: 0,
  },
  condition: {
    type: String,
    enum: ["excellent", "good", "fair", "poor"],
  },
});

// Create the main schema
const GetApprovedSchema = new Schema<IGetApprovedDocument>(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      maxlength: [50, "First name cannot exceed 50 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
      match: [
        /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/,
        "Please provide a valid email address",
      ],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      match: [/^[\+]?[1-9][\d]{0,15}$/, "Please provide a valid phone number"],
    },
    employmentType: {
      type: String,
      required: [true, "Employment type is required"],
      enum: [
        "salaried",
        "self-employed",
        "business-owner",
        "retired",
        "student",
      ],
    },
    monthlyIncome: {
      type: Number,
      required: [true, "Monthly income is required"],
      min: [0, "Monthly income cannot be negative"],
    },
    creditScoreRange: {
      type: String,
      required: [true, "Credit score range is required"],
      enum: ["excellent", "good", "fair", "poor"],
    },
    applicationId: {
      type: String,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "under-review", "pre-approved", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewedAt: {
      type: Date,
    },
    reviewNotes: {
      type: String,
      trim: true,
      maxlength: [1000, "Review notes cannot exceed 1000 characters"],
    },
    preApprovalAmount: {
      type: Number,
      min: [0, "Pre-approval amount cannot be negative"],
    },
    preApprovalValidUntil: {
      type: Date,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
    },
    termsAccepted: {
      type: Boolean,
      required: [true, "Terms and conditions must be accepted"],
      validate: {
        validator: function (value: boolean) {
          return value === true;
        },
        message: "Terms and conditions must be accepted",
      },
    },
    privacyPolicyAccepted: {
      type: Boolean,
      required: [true, "Privacy policy must be accepted"],
      validate: {
        validator: function (value: boolean) {
          return value === true;
        },
        message: "Privacy policy must be accepted",
      },
    },

    // NEW: Bike enquiry information
    bikeEnquiry: {
      type: BikeEnquirySchema,
      default: null,
    },

    enquiryType: {
      type: String,
      enum: ["general-financing", "specific-bike", "trade-in", "upgrade"],
      default: "general-financing",
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for full name
GetApprovedSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for application age in days
GetApprovedSchema.virtual("applicationAge").get(function () {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - this.createdAt.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Generate unique application ID
GetApprovedSchema.methods.generateApplicationId = function (): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  const prefix = this.enquiryType === "specific-bike" ? "GAB" : "GA"; // GAB for bike-specific enquiries
  return `${prefix}-${timestamp}-${randomStr}`.toUpperCase();
};

// Update status method
GetApprovedSchema.methods.updateStatus = async function (
  newStatus: string,
  reviewerId?: string,
  notes?: string
): Promise<IGetApprovedDocument> {
  this.status = newStatus;
  if (reviewerId) {
    this.reviewedBy = reviewerId;
    this.reviewedAt = new Date();
  }
  if (notes) {
    this.reviewNotes = notes;
  }
  return await this.save();
};

// Set pre-approval method
GetApprovedSchema.methods.setPreApproval = async function (
  amount: number,
  validDays: number = 30
): Promise<IGetApprovedDocument> {
  this.preApprovalAmount = amount;
  this.preApprovalValidUntil = new Date(
    Date.now() + validDays * 24 * 60 * 60 * 1000
  );
  this.status = "pre-approved";
  return await this.save();
};

// Add bike enquiry method
GetApprovedSchema.methods.addBikeEnquiry = async function (
  bikeInfo: any
): Promise<IGetApprovedDocument> {
  this.bikeEnquiry = bikeInfo;
  if (bikeInfo.bikeId || bikeInfo.bikeModel) {
    this.enquiryType = "specific-bike";
  }
  if (bikeInfo.tradeInBike?.hasTradeIn) {
    this.enquiryType = "trade-in";
  }
  return await this.save();
};

// Pre-save middleware to generate application ID
GetApprovedSchema.pre("save", function (next) {
  if (!this.applicationId) {
    this.applicationId = this.generateApplicationId();
  }
  next();
});

// Create indexes for better performance

GetApprovedSchema.index({ status: 1 });
GetApprovedSchema.index({ enquiryType: 1 });
GetApprovedSchema.index({ "bikeEnquiry.bikeId": 1 });
GetApprovedSchema.index({ "bikeEnquiry.category": 1 });
GetApprovedSchema.index({ createdAt: -1 });

// Ensure virtual fields are included in JSON output
GetApprovedSchema.set("toJSON", { virtuals: true });
GetApprovedSchema.set("toObject", { virtuals: true });

const GetApproved = mongoose.model<IGetApprovedDocument>(
  "GetApproved",
  GetApprovedSchema
);

export default GetApproved;
