import mongoose, { Schema, Document } from "mongoose";

export interface IStockConcept extends Document {
  stockId: string;
  modelName: string;
  category: "Bike" | "Scooty";
  engineCC: number;
  color: string;
  variant: string;
  yearOfManufacture: number;
  uniqueBookRecord?: string;
  engineNumber: string;
  chassisNumber: string;
  stockStatus: {
    status:
      | "Available"
      | "Sold"
      | "Reserved"
      | "Service"
      | "Damaged"
      | "Transit";
    location: "Showroom" | "Warehouse" | "Service Center" | "Customer";
    branchId: mongoose.Types.ObjectId;
    lastUpdated: Date;
    updatedBy: mongoose.Types.ObjectId;
  };
  salesInfo?: {
    soldTo: mongoose.Types.ObjectId; // Current owner
    soldDate?: Date;
    salePrice?: number;
    salesPerson?: mongoose.Types.ObjectId;
    invoiceNumber?: string;
    paymentStatus?: "Paid" | "Partial" | "Pending";
    customerVehicleId?: mongoose.Types.ObjectId;
  };
  salesHistory: Array<{
    soldTo: mongoose.Types.ObjectId;
    soldDate: Date;
    salePrice: number;
    salesPerson: mongoose.Types.ObjectId;
    invoiceNumber: string;
    paymentStatus: "Paid" | "Partial" | "Pending";
    customerVehicleId: mongoose.Types.ObjectId;
    transferType?: "New Sale" | "Ownership Transfer" | "Resale";
  }>;
  priceInfo: {
    exShowroomPrice: number;
    roadTax: number;
    onRoadPrice: number;
  };
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const stockConceptSchema = new Schema<IStockConcept>(
  {
    stockId: { type: String, required: true, unique: true },
    modelName: { type: String, required: true },
    category: { type: String, required: true, enum: ["Bike", "Scooty"] },
    engineCC: { type: Number, required: true },
    color: { type: String, required: true },
    variant: { type: String, required: true },
    yearOfManufacture: {
      type: Number,
      required: true,
      min: 2000,
      max: new Date().getFullYear() + 1,
    },
    engineNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    chassisNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },

    stockStatus: {
      status: {
        type: String,
        enum: [
          "Available",
          "Sold",
          "Reserved",
          "Service",
          "Damaged",
          "Transit",
        ],
        default: "Available",
        required: true,
      },
      location: {
        type: String,
        enum: ["Showroom", "Warehouse", "Service Center", "Customer"],
        default: "Warehouse",
        required: true,
      },
      branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
      lastUpdated: { type: Date, default: Date.now },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    },

    salesInfo: {
      soldTo: { type: Schema.Types.ObjectId, ref: "BaseCustomer" },
      soldDate: Date,
      salePrice: Number,
      salesPerson: { type: Schema.Types.ObjectId, ref: "User" },
      invoiceNumber: String,
      paymentStatus: { type: String, enum: ["Paid", "Partial", "Pending"] },
      customerVehicleId: {
        type: Schema.Types.ObjectId,
        ref: "CustomerVehicle",
      },
    },

    salesHistory: [
      {
        soldTo: {
          type: Schema.Types.ObjectId,
          ref: "BaseCustomer",
          required: true,
        },
        soldDate: { type: Date, required: true },
        salePrice: { type: Number, required: true },
        salesPerson: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        invoiceNumber: { type: String, required: true },
        paymentStatus: {
          type: String,
          enum: ["Paid", "Partial", "Pending"],
          required: true,
        },
        customerVehicleId: {
          type: Schema.Types.ObjectId,
          ref: "CustomerVehicle",
          required: true,
        },
        transferType: {
          type: String,
          enum: ["New Sale", "Ownership Transfer", "Resale"],
          default: "New Sale",
        },
      },
    ],

    priceInfo: {
      exShowroomPrice: { type: Number, required: true, min: 0 },
      roadTax: { type: Number, required: true, min: 0 },
      onRoadPrice: { type: Number, required: true, min: 0 },
    },

    uniqueBookRecord: { type: String, trim: true, sparse: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
stockConceptSchema.index({ "salesInfo.soldTo": 1 });
stockConceptSchema.index({ "stockStatus.status": 1 });
stockConceptSchema.index({ "salesHistory.soldTo": 1 });

export const StockConceptModel = mongoose.model<IStockConcept>(
  "StockConcept",
  stockConceptSchema
);

//https://claude.ai/chat/5e0a0653-5991-4de1-b9e4-376306f8fc84
