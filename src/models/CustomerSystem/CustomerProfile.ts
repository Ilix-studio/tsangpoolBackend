// models/CustomerSystem/CustomerProfile.ts
import mongoose, { Document, Schema } from "mongoose";
import { IBaseCustomer } from "./BaseCustomer";

export enum BloodGroup {
  A_POSITIVE = "A+",
  A_NEGATIVE = "A-",
  B_POSITIVE = "B+",
  B_NEGATIVE = "B-",
  AB_POSITIVE = "AB+",
  AB_NEGATIVE = "AB-",
  O_POSITIVE = "O+",
  O_NEGATIVE = "O-",
}

export interface ICustomerProfile extends Document {
  _id: string;
  customer: mongoose.Types.ObjectId;
  firstName: string;
  middleName?: string;
  lastName: string;
  email?: string;
  village: string;
  postOffice: string;
  policeStation: string;
  district: string;
  state: string;
  bloodGroup: BloodGroup;
  familyNumber1: number;
  familyNumber2: number;
  profileCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerProfileSchema = new Schema<ICustomerProfile>(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BaseCustomer",
      required: [true, "Customer reference is required"],
      unique: true,
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      minlength: [2, "First name must be at least 2 characters long"],
      maxlength: [30, "First name cannot exceed 30 characters"],
    },
    middleName: {
      type: String,
      trim: true,
      maxlength: [30, "Middle name cannot exceed 30 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      minlength: [2, "Last name must be at least 2 characters long"],
      maxlength: [30, "Last name cannot exceed 30 characters"],
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    village: {
      type: String,
      required: [true, "Village is required"],
      trim: true,
      maxlength: [100, "Village name cannot exceed 100 characters"],
    },
    postOffice: {
      type: String,
      required: [true, "Post office is required"],
      trim: true,
      maxlength: [100, "Post office cannot exceed 100 characters"],
    },
    policeStation: {
      type: String,
      required: [true, "Police station is required"],
      trim: true,
      maxlength: [100, "Police station cannot exceed 100 characters"],
    },
    district: {
      type: String,
      required: [true, "District is required"],
      trim: true,
      maxlength: [100, "District cannot exceed 100 characters"],
    },
    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
      maxlength: [100, "State cannot exceed 100 characters"],
    },
    bloodGroup: {
      type: String,
      required: [true, "Blood group is required"],
      enum: Object.values(BloodGroup),
    },
    familyNumber1: {
      type: Number,
      required: [true, "Family contact number 1 is required"],
    },
    familyNumber2: {
      type: Number,
      required: [true, "Family contact number 2 is required"],
    },
    profileCompleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
customerProfileSchema.index({ customer: 1 });
customerProfileSchema.index({ district: 1 });
customerProfileSchema.index({ state: 1 });

export const CustomerProfileModel = mongoose.model<ICustomerProfile>(
  "CustomerProfile",
  customerProfileSchema,
);
