// models/LeaveApplication.ts
import mongoose, { Document, Schema } from "mongoose";

export type LeaveType = "Sick" | "Casual";
export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export type ApplicantModel =
  | "BranchManager"
  | "ServiceAdmin"
  | "PartAdmin"
  | "Staff";

export interface ILeaveApplication extends Document {
  applicantId: mongoose.Types.ObjectId;
  applicantModel: ApplicantModel;
  applicantRole: string;
  branch: mongoose.Types.ObjectId;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewNote?: string;
  reviewedAt?: Date;
  year: number; // calendar year of application
  createdAt: Date;
  updatedAt: Date;
}

const LeaveApplicationSchema = new Schema<ILeaveApplication>(
  {
    applicantId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "applicantModel",
    },
    applicantModel: {
      type: String,
      required: true,
      enum: ["BranchManager", "ServiceAdmin", "PartAdmin", "Staff"],
    },
    applicantRole: {
      type: String,
      required: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    leaveType: {
      type: String,
      enum: ["Sick", "Casual"],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    totalDays: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    reviewedAt: Date,
    year: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true },
);

// Compound index for efficient balance queries
LeaveApplicationSchema.index({
  applicantId: 1,
  leaveType: 1,
  year: 1,
  status: 1,
});
LeaveApplicationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<ILeaveApplication>(
  "LeaveApplication",
  LeaveApplicationSchema,
);
