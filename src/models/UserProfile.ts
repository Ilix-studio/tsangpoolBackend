import mongoose, { Document, Schema } from "mongoose";

/**
 * Profile extension shared by every role (Super-Admin, Branch-Admin,
 * Service-Admin, Part-Admin, Staff). Identity fields (name/email/phone/address)
 * live on the role model; this holds the extra profile fields that don't.
 * Keyed by the user's _id (unique across all role collections).
 */
export interface IUserProfile extends Document {
  userId: mongoose.Types.ObjectId;
  role: string;
  bloodGroup?: string;
  lifeInsurance?: string;
  scanfleetStickerId?: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<IUserProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    role: { type: String, required: true },
    bloodGroup: { type: String, trim: true, maxlength: 8 },
    lifeInsurance: { type: String, trim: true, maxlength: 160 },
    scanfleetStickerId: { type: String, trim: true, maxlength: 160 },
    // Optional address override — mainly for Super-Admin (whose role model has
    // no address field); other roles fall back to their role-model address.
    address: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

export const UserProfileModel = mongoose.model<IUserProfile>(
  "UserProfile",
  UserProfileSchema,
);
