import mongoose, { Document, Schema } from "mongoose";

/**
 * A maintenance request raised by a dealership admin for the Developer role.
 *
 * "Messaging the developer" and "a maintenance service" are the same record:
 * creating a message *is* creating a maintenance ticket, so there is one
 * collection rather than a message log plus a ticket table.
 *
 * `raisedBy` is polymorphic through `refPath: "raisedByModel"`, the same
 * pattern LeaveApplication uses — Branch-Admin, Service-Admin and Part-Admin
 * live in separate collections, so a single `ref` cannot address all three.
 */
export type MaintenanceStatus = "open" | "in_progress" | "resolved";
export type MaintenancePriority = "low" | "normal" | "high";

/** Role collections allowed to raise a request. */
export type MaintenanceRaiserModel =
  | "Admin"
  | "BranchManager"
  | "ServiceAdmin"
  | "PartAdmin";

export interface IMaintenanceService extends Document {
  title: string;
  description: string;
  /** Optional target date. Absent means "no deadline given", never a default. */
  deadline?: Date | null;
  status: MaintenanceStatus;
  priority: MaintenancePriority;

  raisedBy: mongoose.Types.ObjectId;
  raisedByModel: MaintenanceRaiserModel;
  /** Role string as it was at creation time, for display without a populate. */
  raisedByRole: string;
  /** Snapshot of the reporter's name — survives the account being deleted. */
  raisedByName: string;
  /** Reporter's branch. Absent only if their account had none. */
  branch?: mongoose.Types.ObjectId | null;

  /** Set when a Developer moves the request out of "open". */
  developerNote?: string;
  resolvedAt?: Date | null;

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MaintenanceServiceSchema = new Schema<IMaintenanceService>(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [150, "Title cannot exceed 150 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },
    deadline: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved"],
      default: "open",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },

    raisedBy: {
      type: Schema.Types.ObjectId,
      refPath: "raisedByModel",
      required: true,
      index: true,
    },
    raisedByModel: {
      type: String,
      enum: ["Admin", "BranchManager", "ServiceAdmin", "PartAdmin"],
      required: true,
    },
    raisedByRole: {
      type: String,
      required: true,
    },
    raisedByName: {
      type: String,
      required: true,
      trim: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },

    developerNote: {
      type: String,
      trim: true,
      maxlength: [2000, "Note cannot exceed 2000 characters"],
    },
    resolvedAt: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    // createdAt is the "raised at" timestamp the dashboard sorts and reports on.
    timestamps: true,
  },
);

// Dashboard reads newest-first within a status; reporters read their own feed.
MaintenanceServiceSchema.index({ isActive: 1, status: 1, createdAt: -1 });
MaintenanceServiceSchema.index({ raisedBy: 1, createdAt: -1 });

export const MaintenanceServiceModel = mongoose.model<IMaintenanceService>(
  "MaintenanceService",
  MaintenanceServiceSchema,
);

export default MaintenanceServiceModel;
