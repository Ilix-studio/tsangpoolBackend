// models/AccidentReport.ts
import mongoose, { Document, Schema } from "mongoose";

export type ReportStatus = "pending" | "reviewed" | "closed";

export interface IAccidentReport extends Document {
  reportId: string; // e.g. AR-XXXX-XXXX
  customer: mongoose.Types.ObjectId;
  branch: mongoose.Types.ObjectId;

  title: string;
  date: Date;
  time: string; // "HH:MM" — stored separately for form fidelity
  location: string;
  isInsuranceAvailable: boolean;

  // Admin workflow
  status: ReportStatus;
  adminNotes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const AccidentReportSchema = new Schema<IAccidentReport>(
  {
    reportId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "BaseCustomer",
      required: [true, "Customer reference is required"],
      index: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch reference is required"],
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    date: {
      type: Date,
      required: [true, "Accident date is required"],
    },
    time: {
      type: String,
      required: [true, "Accident time is required"],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:MM format"],
    },
    location: {
      type: String,
      required: [true, "Location is required"],
      trim: true,
      maxlength: [500, "Location cannot exceed 500 characters"],
    },
    isInsuranceAvailable: {
      type: Boolean,
      required: [true, "Insurance availability field is required"],
      default: false,
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "closed"],
      default: "pending",
      index: true,
    },
    adminNotes: {
      type: String,
      trim: true,
      maxlength: [1000, "Admin notes cannot exceed 1000 characters"],
    },
  },
  { timestamps: true }
);

AccidentReportSchema.index({ customer: 1, status: 1 });
AccidentReportSchema.index({ branch: 1, status: 1 });
AccidentReportSchema.index({ date: -1 });

const AccidentReportModel = mongoose.model<IAccidentReport>(
  "AccidentReport",
  AccidentReportSchema
);

export default AccidentReportModel;
