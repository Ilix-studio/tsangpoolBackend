// models/BikeSystemModel2/StockConceptCSV.ts

import mongoose, { Schema, Document } from "mongoose";
import { writeFileXLSX } from "xlsx";

export interface IStockConceptCSV extends Document {
  stockId: string;

  // Core fields (always required)
  modelVariant: string;
  engineNumber: string;
  frameNumber: string;
  color: string;
  costPrice?: number;

  // CSV metadata
  csvImportBatch: string;
  csvImportDate: Date;
  csvFileName: string;

  // Where this record came from — real CSV upload vs. the automatic
  // placeholder created when a service-jobcard import can't match an
  // existing stock record by frame number.
  creationSource: "csv_import" | "automatic_creation";

  // Dynamic fields container
  csvData: Record<string, any>; // Stores ALL CSV columns

  // Schema version tracking
  schemaVersion: number;
  detectedColumns: string[];

  // Stock status (simplified)
  stockStatus: {
    status: "Available" | "Sold" | "Reserved" | "Service";
    location: string; // From CSV, not enum
    branchId: mongoose.Types.ObjectId;
    updatedBy: mongoose.Types.ObjectId;
  };

  // Sales (when assigned to customer)
  salesInfo?: {
    soldTo?: mongoose.Types.ObjectId;
    soldDate?: Date;
    salePrice?: number;
    invoiceNumber?: string;
    paymentStatus?: "Paid" | "Partial" | "Pending";
    customerVehicleId?: mongoose.Types.ObjectId;
  };

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const stockConceptCSVSchema = new Schema<IStockConceptCSV>(
  {
    stockId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Core required fields
    modelVariant: { type: String, required: true },
    engineNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    frameNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    color: { type: String, required: true },
    costPrice: { type: Number, min: 0 },

    // Where this record came from — real CSV upload vs. the automatic
    // placeholder created when a service-jobcard import can't match an
    // existing stock record by frame number.
    creationSource: {
      type: String,
      enum: ["csv_import", "automatic_creation"],
      default: "csv_import",
    },

    // CSV tracking
    csvImportBatch: {
      type: String,
      required: true,
      index: true,
    },
    csvImportDate: { type: Date, required: true },
    csvFileName: { type: String, required: true },

    // DYNAMIC: Stores all CSV columns as key-value pairs
    csvData: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },

    schemaVersion: { type: Number, default: 1 },
    detectedColumns: [{ type: String }],

    stockStatus: {
      status: {
        type: String,
        enum: ["Available", "Sold", "Reserved", "Service"],
        default: "Available",
        required: true,
        index: true,
      },
      location: {
        type: String,
        required: true,
        uppercase: true,
      },
      branchId: {
        type: Schema.Types.ObjectId,
        ref: "Branch",
        required: true,
      },
      updatedBy: {
        type: Schema.Types.ObjectId,
        required: true,
      },
    },

    salesInfo: {
      soldTo: { type: Schema.Types.ObjectId, ref: "BaseCustomer" },
      soldDate: Date,
      salePrice: Number,
      invoiceNumber: String,
      paymentStatus: {
        type: String,
        enum: ["Paid", "Partial", "Pending"],
      },
      customerVehicleId: {
        type: Schema.Types.ObjectId,
        ref: "CustomerVehicle",
      },
    },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    strict: false, // Allow dynamic fields
  },
);

// Indexes
stockConceptCSVSchema.index({ "stockStatus.status": 1, csvImportBatch: 1 });
stockConceptCSVSchema.index({ "salesInfo.soldTo": 1 });

export const StockConceptCSVModel = mongoose.model<IStockConceptCSV>(
  "StockConceptCSV",
  stockConceptCSVSchema,
);
