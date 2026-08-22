import mongoose from "mongoose";
import admin from "../config/firebaseAdmin";
import logger from "../utils/logger";
import { ROLE_MODEL_MAP } from "../utils/roleModels";
import { ROLES, UserRole } from "../types/user.types";
import { DeviceTokenModel } from "../models/DeviceToken";
import { NotificationModel } from "../models/Notification";
import { NotificationType } from "../types/notification.types";

/**
 * pushNotification.service — the single place that turns an application event
 * into (a) durable per-recipient Notification history rows and (b) best-effort
 * FCM push delivery to every registered device of those recipients.
 *
 * Reuses the already-initialized Firebase Admin app in config/firebaseAdmin.ts
 * (only .auth() was used before; this is the first .messaging() consumer).
 *
 * Design notes:
 *  - Recipients are resolved from the authoritative role collections (not from
 *    DeviceToken) so history exists even for users who never registered a device.
 *  - Delivery is best-effort and fully guarded: this never throws into the
 *    request path. Trigger sites additionally fire-and-forget with .catch().
 */

/** A recipient rule. `branch === undefined` means "any branch" (no filter). */
export interface Audience {
  roles: UserRole[];
  branch?: string | mongoose.Types.ObjectId | null;
}

export interface NotifyEvent {
  audiences: Audience[];
  type: NotificationType;
  title: string;
  body: string;
  /** FCM data payload — values must be strings. Used for client deep-linking. */
  data?: Record<string, string>;
}

/**
 * Resolve the distinct set of recipient users (userId -> role) from the role
 * collections for the given audience rules.
 */
async function resolveRecipients(
  audiences: Audience[],
): Promise<Map<string, string>> {
  const recipients = new Map<string, string>();

  for (const audience of audiences) {
    for (const role of audience.roles) {
      const model = ROLE_MODEL_MAP[role];
      if (!model) continue;

      const query: Record<string, any> = { isActive: true };

      if (role === ROLES.SUPER_ADMIN) {
        // The Admin collection can hold both Super-Admin and (legacy) Branch-Admin
        // docs; only Super-Admins should match here.
        query.role = ROLES.SUPER_ADMIN;
      } else if (audience.branch !== undefined && audience.branch !== null) {
        query.branch = audience.branch;
      }

      const docs = await model.find(query).select("_id").lean();
      for (const doc of docs) {
        recipients.set(String((doc as any)._id), role);
      }
    }
  }

  return recipients;
}

/**
 * Persist notification history, then push to all of the recipients' devices.
 * Safe to call fire-and-forget.
 */
export async function notify(event: NotifyEvent): Promise<void> {
  try {
    const { audiences, type, title, body, data } = event;

    const recipients = await resolveRecipients(audiences);
    if (recipients.size === 0) return;

    // 1) Durable history — one row per recipient user.
    const historyDocs = [...recipients].map(([userId, role]) => ({
      userId: new mongoose.Types.ObjectId(userId),
      role,
      type,
      title,
      body,
      data,
      isRead: false,
    }));
    await NotificationModel.insertMany(historyDocs, { ordered: false });

    // 2) Best-effort push to every active device of those users.
    const userIds = [...recipients.keys()].map(
      (id) => new mongoose.Types.ObjectId(id),
    );
    const deviceTokens = await DeviceTokenModel.find({
      userId: { $in: userIds },
      isActive: true,
    }).lean();

    if (deviceTokens.length === 0) return;

    const tokens = deviceTokens.map((d) => d.token);
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { type, ...(data ?? {}) },
      webpush: {
        notification: { title, body, icon: "/icons/icon-192.png" },
        fcmOptions: data?.route ? { link: data.route } : undefined,
      },
    });

    // 3) Prune tokens FCM reports as permanently invalid.
    const deadTokens: string[] = [];
    response.responses.forEach((res, i) => {
      if (res.success) return;
      const code = res.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        deadTokens.push(deviceTokens[i].token);
      }
    });
    if (deadTokens.length > 0) {
      await DeviceTokenModel.deleteMany({ token: { $in: deadTokens } });
      logger.info(`Pruned ${deadTokens.length} dead FCM token(s)`);
    }

    if (response.failureCount > 0) {
      logger.warn(
        `Push "${type}": ${response.successCount} sent, ${response.failureCount} failed`,
      );
    }
  } catch (err) {
    logger.error(`notify() failed for "${event.type}": ${(err as Error).message}`);
  }
}
