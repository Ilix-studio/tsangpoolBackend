import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";
import { generateToken, generateRefreshToken } from "../utils/jwt";
import {
  IRefreshTokenSession,
  RefreshTokenSessionSchema,
} from "./shared/refreshTokenSession";

/**
 * Developer — a project-wide maintenance role, created by Super-Admin only.
 *
 * Deliberately NOT branch-scoped (no `branch` field, unlike BranchManager /
 * ServiceAdmin / PartAdmin): a Developer maintains the whole system, so the
 * maintenance queue they work from spans every branch. `getUserBranch` returns
 * null for them, which keeps branch-scoped endpoints from silently matching on
 * `undefined`.
 *
 * Logs in by email rather than phone — like Super-Admin, and unlike the
 * branch roles — since it is an out-of-dealership technical account.
 */
export interface IDeveloper extends Document {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  isActive: boolean;
  refreshTokens: IRefreshTokenSession[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
  getSignedJwtToken(): string;
  getSignedRefreshToken(): string;
}

const DeveloperSchema = new Schema<IDeveloper>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, "Please provide a valid 10-digit phone number"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshTokens: {
      type: [RefreshTokenSessionSchema],
      default: [],
      select: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

DeveloperSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

DeveloperSchema.methods.matchPassword = async function (
  enteredPassword: string,
): Promise<boolean> {
  return bcrypt.compare(enteredPassword, this.password);
};

DeveloperSchema.methods.getSignedJwtToken = function (): string {
  return generateToken({ id: this._id, role: "Developer" });
};

DeveloperSchema.methods.getSignedRefreshToken = function (): string {
  return generateRefreshToken({ id: this._id, role: "Developer" });
};

export default mongoose.model<IDeveloper>("Developer", DeveloperSchema);
