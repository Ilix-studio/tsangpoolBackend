// models/BikeSystemModel2/VASmodel.ts
import mongoose, { Schema } from "mongoose";
import { IValueAddedService } from "../../types/vas.types";

const valueAddedServiceSchema = new Schema<IValueAddedService>(
  {
    serviceName: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      maxlength: [100, "Service name cannot exceed 100 characters"],
    },

    coverageYears: {
      type: Number,
      required: [true, "Coverage years is required"],
      min: [1, "Minimum 1 year coverage"],
      max: [10, "Maximum 10 years coverage"],
    },

    priceStructure: {
      basePrice: {
        type: Number,
        required: [true, "Base price is required"],
        min: [0, "Price cannot be negative"],
      },
    },

    benefits: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
    },

    applicableBranches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],

    validFrom: {
      type: Date,
      default: Date.now,
    },

    validUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
valueAddedServiceSchema.index({ isActive: 1 });
valueAddedServiceSchema.index({ coverageYears: 1 });

const ValueAddedServiceModel = mongoose.model<IValueAddedService>(
  "ValueAddedService",
  valueAddedServiceSchema,
);

export default ValueAddedServiceModel;
