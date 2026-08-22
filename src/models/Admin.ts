import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";
import { generateToken, generateRefreshToken } from "../utils/jwt";
import {
  IRefreshTokenSession,
  RefreshTokenSessionSchema,
} from "./shared/refreshTokenSession";

export interface IAdmin extends Document {
  name: string;
  email: string;
  phoneNumber?: string;
  password: string;
  role: "Super-Admin" | "Branch-Admin";
  isActive: boolean;
  refreshTokens: IRefreshTokenSession[];
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
  getSignedJwtToken(): string;
  getSignedRefreshToken(): string;
}

const AdminSchema = new Schema<IAdmin>(
  {
    name: {
      type: String,
      required: [true, "Please add a name"],
    },
    email: {
      type: String,
      required: [true, "Please add an email"],
      unique: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email",
      ],
    },
    phoneNumber: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, "Please provide a valid 10-digit phone number"],
    },
    password: {
      type: String,
      required: [true, "Please add a password"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ["Super-Admin", "Branch-Admin"],
      default: "Super-Admin",
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
  },
  {
    timestamps: true,
  }
);

// Encrypt password using bcrypt
AdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
AdminSchema.methods.matchPassword = async function (
  enteredPassword: string
): Promise<boolean> {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Sign JWT and return
AdminSchema.methods.getSignedJwtToken = function (): string {
  return generateToken({
    id: this._id,
    role: this.role,
  });
};

AdminSchema.methods.getSignedRefreshToken = function (): string {
  return generateRefreshToken({
    id: this._id,
    role: this.role,
  });
};

const AdminModel = mongoose.model<IAdmin>("Admin", AdminSchema);

export default AdminModel;
