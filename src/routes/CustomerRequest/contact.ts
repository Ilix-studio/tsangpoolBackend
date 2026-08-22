// src/routes/contact.ts
import express from "express";

import { protect } from "../../middleware/authmiddleware";
import { formLimiter } from "../../middleware/phoneNoValidation";
import {
  sendMessage,
  deleteMessage,
  getMessageById,
  getMessages,
  markAsRead,
} from "../../controllers/CustomerRequest/contact.controller";

const router = express.Router();

// Public routes
router.post(
  "/send",
  formLimiter, // Rate limit contact form submissions
  sendMessage,
);

// Protected routes (Admin only)
router.get("/get", protect, getMessages);

router.get("/:id", protect, getMessageById);

router.patch("/:id/read", protect, markAsRead);

router.delete("/:id", protect, deleteMessage);

export default router;
