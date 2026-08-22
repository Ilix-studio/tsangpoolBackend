import mongoose, { Document, Schema } from "mongoose";

// Variant interface for multiple options
export interface IBikeVariant {
  name: string;
  features: string[];
  priceAdjustment: number;
  isAvailable: boolean;
}

// Price breakdown interface
export interface IPriceBreakdown {
  exShowroomPrice: number;
  rtoCharges: number;
  insuranceComprehensive: number;
  onRoadPrice?: number;
}

// Enhanced Bikes Document interface (without images array)
export interface IBikesDocument extends Document {
  modelName: string;
  mainCategory: "bike" | "scooter";
  category:
    | "sport"
    | "adventure"
    | "cruiser"
    | "touring"
    | "naked"
    | "electric"
    | "commuter"
    | "automatic"
    | "gearless";
  year: number;
  variants: IBikeVariant[];
  priceBreakdown: IPriceBreakdown;
  engineSize: string;
  power: number;
  transmission: string;
  fuelNorms: "BS4" | "BS6" | "BS6 Phase 2" | "Electric";
  isE20Efficiency: boolean;
  features: string[];
  colors: string[];
  stockAvailable: number;
  isNewModel?: boolean;
  isActive: boolean;
  keySpecifications: {
    engine?: string;
    power?: string;
    transmission?: string;
    year?: number;
    fuelNorms?: string;
    isE20Efficiency?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const BikeVariantSchema = new Schema<IBikeVariant>({
  name: {
    type: String,
    required: [true, "Variant name is required"],
    trim: true,
  },
  features: [String],
  priceAdjustment: {
    type: Number,
    default: 0,
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
});

const PriceBreakdownSchema = new Schema<IPriceBreakdown>({
  exShowroomPrice: {
    type: Number,
    required: [true, "Ex-showroom price is required"],
    min: [0, "Ex-showroom price must be positive"],
  },
  rtoCharges: {
    type: Number,
    required: [true, "RTO charges are required"],
    min: [0, "RTO charges must be positive"],
  },
  insuranceComprehensive: {
    type: Number,
    required: [true, "Insurance amount is required"],
    min: [0, "Insurance amount must be positive"],
  },
  onRoadPrice: {
    type: Number,
  },
});

const BikesSchema = new Schema<IBikesDocument>(
  {
    modelName: {
      type: String,
      required: [true, "Please add vehicle model name"],
      trim: true,
      maxlength: [100, "Model name cannot exceed 100 characters"],
    },
    mainCategory: {
      type: String,
      required: [true, "Please specify main category"],
      enum: {
        values: ["bike", "scooter"],
        message: "Main category must be either bike or scooter",
      },
    },
    category: {
      type: String,
      required: [true, "Please add vehicle category"],
      enum: {
        values: [
          "sport",
          "adventure",
          "cruiser",
          "touring",
          "naked",
          "electric",
          "commuter",
          "automatic",
          "gearless",
        ],
        message: "Invalid category selected",
      },
    },
    year: {
      type: Number,
      required: [true, "Please add manufacturing year"],
      min: [2000, "Year must be 2000 or later"],
      max: [
        new Date().getFullYear() + 2,
        "Year cannot be more than 2 years in future",
      ],
    },
    variants: {
      type: [BikeVariantSchema],
      validate: {
        validator: function (variants: IBikeVariant[]) {
          return variants && variants.length > 0;
        },
        message: "At least one variant is required",
      },
    },
    priceBreakdown: {
      type: PriceBreakdownSchema,
      required: [true, "Price breakdown is required"],
    },
    engineSize: {
      type: String,
      required: [true, "Please add engine details"],
      trim: true,
    },
    power: {
      type: Number,
      required: [true, "Please add power specifications"],
      min: [1, "Power must be positive"],
    },
    transmission: {
      type: String,
      required: [true, "Please add transmission details"],
      trim: true,
    },
    fuelNorms: {
      type: String,
      required: [true, "Please specify fuel norms"],
      enum: {
        values: ["BS4", "BS6", "BS6 Phase 2", "Electric"],
        message:
          "Invalid fuel norm. Must be BS4, BS6, BS6 Phase 2, or Electric",
      },
    },
    isE20Efficiency: {
      type: Boolean,
      default: false,
      required: [true, "Please specify E20 efficiency compatibility"],
    },
    features: {
      type: [String],
      default: [],
    },
    colors: {
      type: [String],
      validate: {
        validator: function (colors: string[]) {
          return colors && colors.length > 0;
        },
        message: "At least one color option is required",
      },
    },
    stockAvailable: {
      type: Number,
      default: 0,
      min: [0, "Stock cannot be negative"],
    },
    isNewModel: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    keySpecifications: {
      engine: String,
      power: String,
      transmission: String,
      year: Number,
      fuelNorms: String,
      isE20Efficiency: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to calculate on-road price
BikesSchema.pre("save", function (next) {
  if (this.priceBreakdown) {
    this.priceBreakdown.onRoadPrice =
      this.priceBreakdown.exShowroomPrice +
      this.priceBreakdown.rtoCharges +
      this.priceBreakdown.insuranceComprehensive;
  }

  // Auto-populate key specifications
  this.keySpecifications = {
    engine: this.engineSize,
    power: `${this.power} HP`,
    transmission: this.transmission,
    year: this.year,
    fuelNorms: this.fuelNorms,
    isE20Efficiency: this.isE20Efficiency,
  };

  next();
});

// Create compound unique index
BikesSchema.index({ modelName: 1, year: 1 }, { unique: true });

// Additional performance indexes
BikesSchema.index({ mainCategory: 1 });
BikesSchema.index({ category: 1 });
BikesSchema.index({ year: -1 });
BikesSchema.index({ isActive: 1 });
BikesSchema.index({ fuelNorms: 1 });
BikesSchema.index({ isE20Efficiency: 1 });
BikesSchema.index({ "priceBreakdown.onRoadPrice": 1 });

const BikeModel = mongoose.model<IBikesDocument>("Bikes", BikesSchema);
export default BikeModel;
