// models/BikeSystemModel2/CustomerVehicleModel.ts
import mongoose, { Document, Schema } from "mongoose";

export interface ICustomerVehicle extends Document {
  _id: string;

  // Core references
  stockConcept: mongoose.Types.ObjectId;
  stockType: "StockConcept" | "StockConceptCSV";
  customer: mongoose.Types.ObjectId;

  // Ownership essentials
  registrationDate?: Date;
  purchaseDate?: Date;
  numberPlate?: string;
  registeredOwnerName?: string;

  // Payment status
  isPaid: boolean;
  isFinance: boolean;
  insurance: boolean;

  // RTO Information
  rtoInfo?: {
    rtoCode: string;
    rtoName: string;
    rtoAddress: string;
    state: string;
  };

  // Service tracking
  serviceStatus: {
    lastServiceDate?: Date;
    nextServiceDue?: Date;
    kilometers: number;
    serviceHistory: number;
    amcActive: boolean;
  };

  // Cumulative spend on this vehicle, rolled up from every service-jobcard
  // import row matched to it (see service/ServiceJobcard/autoRegisterCustomer.service.ts).
  serviceExpenses: {
    partsRevenue: number;
    lubesRevenue: number;
    totalJobCardRevenue: number;
  };

  // Value Added Services
  activeValueAddedServices: Array<{
    serviceId: mongoose.Types.ObjectId;
    activatedDate: Date;
    expiryDate: Date;
    purchasePrice: number;
    coverageYears: number;
    isActive: boolean;
  }>;

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerVehicleSchema = new Schema<ICustomerVehicle>(
  {
    // Core references
    stockConcept: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "stockType",
      required: [true, "Stock concept reference is required"],
      index: true,
    },
    stockType: {
      type: String,
      enum: ["StockConcept", "StockConceptCSV"], // add "StockConceptCSV"
      required: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BaseCustomer",
      required: [true, "Customer reference is required"],
      unique: true,
    },

    // Ownership essentials
    registrationDate: {
      type: Date,
      validate: {
        validator: function (date: Date) {
          return !date || date <= new Date();
        },
        message: "Registration date cannot be in future",
      },
    },

    purchaseDate: {
      type: Date,
      validate: {
        validator: function (date: Date) {
          return !date || date <= new Date();
        },
        message: "Purchase date cannot be in future",
      },
    },

    numberPlate: {
      type: String,
      sparse: true,
      trim: true,
      unique: true,
      uppercase: true,
      match: [
        /^[A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}$/,
        "Invalid number plate format",
      ],
    },

    registeredOwnerName: {
      type: String,
      trim: true,
      maxlength: [100, "Owner name cannot exceed 100 characters"],
    },

    // Payment status
    isPaid: {
      type: Boolean,
      default: false,
    },

    isFinance: {
      type: Boolean,
      default: false,
    },

    insurance: {
      type: Boolean,
      required: [true, "Insurance status is required"],
      default: false,
    },

    // RTO Information
    rtoInfo: {
      rtoCode: {
        type: String,
        uppercase: true,
        match: [/^[A-Z]{2}[0-9]{2}$/, "Invalid RTO code format (e.g., MH01)"],
      },
      rtoName: {
        type: String,
        trim: true,
      },
      rtoAddress: {
        type: String,
        trim: true,
      },
      state: {
        type: String,
        trim: true,
        uppercase: true,
      },
    },

    // Service tracking
    serviceStatus: {
      lastServiceDate: Date,
      nextServiceDue: Date,
      kilometers: {
        type: Number,
        min: [0, "Kilometers cannot be negative"],
        default: 0,
      },
      serviceHistory: {
        type: Number,
        default: 0,
        min: [0, "Service history cannot be negative"],
      },
      amcActive: {
        type: Boolean,
        default: false,
      },
    },

    // Cumulative spend rolled up from service-jobcard imports
    serviceExpenses: {
      partsRevenue: {
        type: Number,
        default: 0,
        min: [0, "Parts revenue cannot be negative"],
      },
      lubesRevenue: {
        type: Number,
        default: 0,
        min: [0, "Lubes revenue cannot be negative"],
      },
      totalJobCardRevenue: {
        type: Number,
        default: 0,
        min: [0, "Total job card revenue cannot be negative"],
      },
    },

    // Value Added Services
    activeValueAddedServices: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ValueAddedService",
          required: [true, "Service ID is required"],
        },
        activatedDate: {
          type: Date,
          required: [true, "Activation date is required"],
          default: Date.now,
        },
        expiryDate: {
          type: Date,
          required: [true, "Expiry date is required"],
        },
        purchasePrice: {
          type: Number,
          required: [true, "Purchase price is required"],
          min: [0, "Price cannot be negative"],
        },
        coverageYears: {
          type: Number,
          required: [true, "Coverage years is required"],
          min: [1, "Minimum 1 year coverage"],
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
customerVehicleSchema.index({ "activeValueAddedServices.serviceId": 1 });
customerVehicleSchema.index({ "serviceStatus.nextServiceDue": 1 });

// Virtual: vehicle details from StockConcept
customerVehicleSchema.virtual("vehicleDetails", {
  ref: "StockConcept",
  localField: "stockConcept",
  foreignField: "_id",
  justOne: true,
});

// Virtual: bike images
customerVehicleSchema.virtual("motorcycleImages", {
  ref: "BikeImage",
  localField: "stockConcept",
  foreignField: "bikeId",
  options: { sort: { isPrimary: -1, createdAt: -1 } },
});

// Virtual: primary bike image
customerVehicleSchema.virtual("primaryMotorcycleImage", {
  ref: "BikeImage",
  localField: "stockConcept",
  foreignField: "bikeId",
  justOne: true,
  options: {
    match: { isPrimary: true },
    sort: { createdAt: -1 },
  },
});

customerVehicleSchema.set("toJSON", { virtuals: true });
customerVehicleSchema.set("toObject", { virtuals: true });

export const CustomerVehicleModel = mongoose.model<ICustomerVehicle>(
  "CustomerVehicle",
  customerVehicleSchema
);
