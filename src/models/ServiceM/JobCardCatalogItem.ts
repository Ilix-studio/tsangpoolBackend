import mongoose, { Document, Schema } from "mongoose";
import {
  IJobCardCatalogItem,
  LINE_ITEM_TYPES,
} from "../../types/jobCard.types";

export interface IJobCardCatalogItemDocument
  extends IJobCardCatalogItem, Document {}

const jobCardCatalogItemSchema = new Schema<IJobCardCatalogItemDocument>(
  {
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch is required"],
      index: true,
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
      maxlength: [200, "Name cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    defaultUnitPrice: {
      type: Number,
      required: [true, "Default unit price is required"],
      min: [0, "Price cannot be negative"],
    },
    defaultTaxRate: {
      type: Number,
      default: 18,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      // Ref is intentionally untyped — can be ServiceAdmin or BranchManager
    },
  },
  {
    timestamps: true,
  },
);

// Compound index: a branch shouldn't have two active items with the same name
jobCardCatalogItemSchema.index(
  { branch: 1, name: 1, itemType: 1 },
  { unique: true },
);

export const JobCardCatalogItemModel =
  mongoose.model<IJobCardCatalogItemDocument>(
    "JobCardCatalogItem",
    jobCardCatalogItemSchema,
  );
