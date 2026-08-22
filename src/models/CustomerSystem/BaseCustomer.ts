// models/CustomerSystem/BaseCustomer.ts
import mongoose, { Document, Schema } from "mongoose";

export interface IBaseCustomer extends Document {
  _id: string;
  firebaseUid: string;
  phoneNumber: string;
  isVerified: boolean;
  creationSource:
    | "otp"
    | "automatic_creation"
    | "branch_admin_manual"
    | "new_csv_sales_report";
  // Set once a service-jobcard import records a PAID service against this
  // phone number — the customer's complimentary FREE_SERVICES (see
  // types/serviceBooking.types.ts) are no longer bookable once true.
  freeServicesDisabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const baseCustomerSchema = new Schema<IBaseCustomer>(
  {
    firebaseUid: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      match: [/^[6-9]\d{9}$/, "Please enter a valid 10-digit phone number"],
      trim: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    // "automatic_creation": created by the service-jobcard auto-registration
    // flow (no OTP, no firebaseUid). "branch_admin_manual": created by a
    // Branch-Admin via the no-OTP registration endpoint (has a firebaseUid,
    // obtained via a silently-exchanged Firebase custom token instead of SMS).
    // "new_csv_sales_report": created by matching a row from a Branch-Admin
    // uploaded SalesReport CSV (already-sold vehicle) to a phone number with
    // no existing BaseCustomer — see
    // service/salesReport/processSalesReportRow.service.ts.
    creationSource: {
      type: String,
      enum: [
        "otp",
        "automatic_creation",
        "branch_admin_manual",
        "new_csv_sales_report",
      ],
      default: "otp",
    },
    freeServicesDisabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

baseCustomerSchema.index({ isVerified: 1 });

export const BaseCustomerModel = mongoose.model<IBaseCustomer>(
  "BaseCustomer",
  baseCustomerSchema,
);
