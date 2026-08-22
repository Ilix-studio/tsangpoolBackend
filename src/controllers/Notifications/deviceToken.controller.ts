import asyncHandler from "express-async-handler";
import { Request, Response } from "express";

import logger from "../../utils/logger";
import { DeviceTokenModel } from "../../models/DeviceToken";
import { NotificationModel } from "../../models/Notification";
import { getUserRole, getUserBranch } from "../../types/user.types";

/**
 * @desc    Register (upsert) an FCM device token for the current user
 * @route   POST /api/notifications/register-token
 * @access  Private (any authenticated staff/admin)
 */
export const registerDeviceToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { token, platform } = req.body;
    const user = req.user!;

    if (!token || typeof token !== "string") {
      res.status(400).json({ success: false, message: "token is required" });
      return;
    }

    const branch = getUserBranch(user); // null for Super-Admin

    // Upsert by the (globally unique) token so re-registering the same device,
    // or a token that moved to a different logged-in user, stays consistent.
    await DeviceTokenModel.findOneAndUpdate(
      { token },
      {
        token,
        userId: (user as any)._id,
        role: getUserRole(user),
        branch: branch ?? null,
        platform,
        userAgent: req.get("user-agent"),
        isActive: true,
        lastSeenAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(200).json({ success: true, message: "Device registered" });
  },
);

/**
 * @desc    Unregister an FCM device token (e.g. on logout)
 * @route   POST /api/notifications/unregister-token
 * @access  Private
 */
export const unregisterDeviceToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      res.status(400).json({ success: false, message: "token is required" });
      return;
    }

    await DeviceTokenModel.deleteOne({ token });
    res.status(200).json({ success: true, message: "Device unregistered" });
  },
);

/**
 * @desc    List the current user's notifications (most recent first)
 * @route   GET /api/notifications
 * @access  Private
 */
export const listNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as any)._id;
    const page = Math.max(parseInt(String(req.query.page ?? "1"), 10), 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "20"), 10), 1),
      100,
    );
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      NotificationModel.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NotificationModel.countDocuments({ userId }),
      NotificationModel.countDocuments({ userId, isRead: false }),
    ]);

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        limit,
      },
    });
  },
);

/**
 * @desc    Mark a single notification as read
 * @route   PATCH /api/notifications/:id/read
 * @access  Private
 */
export const markNotificationRead = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as any)._id;
    const notification = await NotificationModel.findOneAndUpdate(
      { _id: req.params.id, userId },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      res.status(404).json({ success: false, message: "Notification not found" });
      return;
    }

    res.status(200).json({ success: true, data: notification });
  },
);

/**
 * @desc    Mark all of the current user's notifications as read
 * @route   PATCH /api/notifications/read-all
 * @access  Private
 */
export const markAllNotificationsRead = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as any)._id;
    const result = await NotificationModel.updateMany(
      { userId, isRead: false },
      { isRead: true },
    );

    logger.info(`Marked ${result.modifiedCount} notification(s) read`);
    res.status(200).json({ success: true, modified: result.modifiedCount });
  },
);
