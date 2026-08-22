import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";
import { generateToken, generateRefreshToken } from "../utils/jwt";
import {
  IRefreshTokenSession,
  RefreshTokenSessionSchema,
} from "./shared/refreshTokenSession";

export interface IStaff extends Document {
  name: string;
  email: string;
  phoneNumber: string;
  address: string;
  position: string;
  password: string;
  branch: mongoose.Types.ObjectId;
  isActive: boolean;
  refreshTokens: IRefreshTokenSession[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
  getSignedJwtToken(): string;
  getSignedRefreshToken(): string;
}

const StaffSchema = new Schema<IStaff>(
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
      trim: true,
      unique: true,
      match: [/^[6-9]\d{9}$/, "Please provide a valid 10-digit phone number"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      maxlength: [300, "Address cannot exceed 300 characters"],
    },
    position: {
      type: String,
      required: [true, "Position is required"],
      trim: true,
      maxlength: [100, "Position cannot exceed 100 characters"],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch is required"],
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
      ref: "BranchManager",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

StaffSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

StaffSchema.methods.matchPassword = async function (
  enteredPassword: string,
): Promise<boolean> {
  return bcrypt.compare(enteredPassword, this.password);
};

StaffSchema.methods.getSignedJwtToken = function (): string {
  return generateToken({
    id: this._id,
    role: "Staff",
    branch: this.branch,
  });
};

StaffSchema.methods.getSignedRefreshToken = function (): string {
  return generateRefreshToken({
    id: this._id,
    role: "Staff",
  });
};

export default mongoose.model<IStaff>("Staff", StaffSchema);
