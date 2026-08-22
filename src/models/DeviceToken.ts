import mongoose, { Document, Schema } from "mongoose";

/**
 * DeviceToken — one FCM registration token belonging to a signed-in staff/admin
 * device. A single user can have many tokens (multiple browsers / devices), so
 * this is its own collection rather than an embedded array on the unique-per-user
 * UserProfile.
 *
 * `userId` is the role model's `_id` (unique across all five role collections,
 * per the `protect` lookup order). `branch` is copied from the user at register
 * time (null for Super-Admin) so branch-scoped fan-out is a single indexed query
 * without joining back to the role models.
 */
export interface IDeviceToken extends Document {
  userId: mongoose.Types.ObjectId;
  role: string;
  branch?: mongoose.Types.ObjectId | null;
  token: string;
  platform?: string;
  userAgent?: string;
  isActive: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
    },
    branch: {
      type: Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    platform: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export const DeviceTokenModel = mongoose.model<IDeviceToken>(
  "DeviceToken",
  DeviceTokenSchema,
);
