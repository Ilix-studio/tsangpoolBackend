import { Schema } from "mongoose";

/** One active refresh-token session (one device/browser) for a user. */
export interface IRefreshTokenSession {
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
}

export const RefreshTokenSessionSchema = new Schema<IRefreshTokenSession>(
  {
    tokenHash: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
  },
  { _id: false },
);
