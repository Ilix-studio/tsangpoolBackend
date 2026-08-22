import mongoose, { Document, Schema } from "mongoose";
import { NotificationType } from "../types/notification.types";

/**
 * Notification — one persisted, per-recipient notification record. Written for
 * every recipient of an event (see pushNotification.service.ts) so admins have a
 * durable history + unread badge even if the live FCM push was missed. This is
 * distinct from the ephemeral push payload: the push is best-effort delivery,
 * this collection is the source of truth for the bell/history UI.
 *
 * `data` carries the event's routing/context (e.g. `{ route, bookingId }`) so
 * the frontend can deep-link when a notification is opened.
 */
export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  role: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
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
    type: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Primary access pattern: a user's most-recent notifications, and unread counts.
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });

export const NotificationModel = mongoose.model<INotification>(
  "Notification",
  NotificationSchema,
);
