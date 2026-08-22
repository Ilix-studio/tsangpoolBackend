import express from "express";
import { protect } from "../../middleware/authmiddleware";
import {
  registerDeviceToken,
  unregisterDeviceToken,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../controllers/Notifications/deviceToken.controller";

const router = express.Router();

// All notification routes require an authenticated staff/admin user.
router.use(protect);

// Device token registration (FCM)
router.post("/register-token", registerDeviceToken);
router.post("/unregister-token", unregisterDeviceToken);

// Notification history + read state
router.get("/", listNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);

export default router;
