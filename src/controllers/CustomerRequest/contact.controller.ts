// src/controllers/contact.controller.ts
import asyncHandler from "express-async-handler";
import { Request, Response, NextFunction } from "express";

import logger from "../../utils/logger";
import ContactModel from "../../models/Contact";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

/**
 * @desc    Create new contact message
 * @route   POST /api/contact/send
 * @access  Public
 */
export const sendMessage = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, subject, message } = req.body;

    // Validation
    if (!name || !email || !subject || !message) {
      res.status(400).json({
        success: false,
        message: "All fields are required",
      });
      return;
    }

    // Create contact message
    const contactMessage = await ContactModel.create({
      name,
      email,
      subject,
      message,
    });

    logger.info(`New contact message received from: ${email}`);

    notify(NotificationEvents.contactMessage({ name, subject })).catch((err) =>
      logger.error(`contact notify failed: ${err}`),
    );

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: {
        id: contactMessage._id,
        name: contactMessage.name,
        email: contactMessage.email,
        subject: contactMessage.subject,
        createdAt: contactMessage.createdAt,
      },
    });
  },
);

/**
 * @desc    Get all contact messages
 * @route   GET /api/contact/messages
 * @access  Private (Admin only)
 */
export const getMessages = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { page = 1, limit = 10, read } = req.query;

    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const skip = (pageNumber - 1) * limitNumber;

    // Build filter query
    let filter: any = {};
    if (read !== undefined) {
      filter.isRead = read === "true";
    }

    const messages = await ContactModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber);

    const totalMessages = await ContactModel.countDocuments(filter);
    const unreadCount = await ContactModel.countDocuments({ isRead: false });

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        current: pageNumber,
        pages: Math.ceil(totalMessages / limitNumber),
        total: totalMessages,
        limit: limitNumber,
      },
      unreadCount,
    });
  },
);

/**
 * @desc    Get single contact message by ID
 * @route   GET /api/contact/messages/:id
 * @access  Private (Admin only)
 */
export const getMessageById = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Message ID is required",
      });
      return;
    }

    const message = await ContactModel.findById(id);

    if (!message) {
      res.status(404).json({
        success: false,
        message: "Message not found",
      });
      return;
    }

    // Mark as read when viewed
    if (!message.isRead) {
      message.isRead = true;
      await message.save();
      logger.info(`Message marked as read: ${message._id}`);
    }

    res.status(200).json({
      success: true,
      data: message,
    });
  },
);

/**
 * @desc    Mark message as read/unread
 * @route   PATCH /api/contact/messages/:id/read
 * @access  Private (Admin only)
 */
export const markAsRead = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { isRead } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Message ID is required",
      });
      return;
    }

    const message = await ContactModel.findByIdAndUpdate(
      id,
      { isRead: isRead ?? true },
      { new: true },
    );

    if (!message) {
      res.status(404).json({
        success: false,
        message: "Message not found",
      });
      return;
    }

    logger.info(
      `Message ${isRead ? "marked as read" : "marked as unread"}: ${
        message._id
      } `,
    );

    res.status(200).json({
      success: true,
      message: `Message ${isRead ? "marked as read" : "marked as unread"}`,
      data: message,
    });
  },
);

/**
 * @desc    Delete contact message
 * @route   DELETE /api/contact/messages/:id
 * @access  Private (Admin only)
 */
export const deleteMessage = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Message ID is required",
      });
      return;
    }

    const message = await ContactModel.findById(id);

    if (!message) {
      res.status(404).json({
        success: false,
        message: "Message not found",
      });
      return;
    }

    await ContactModel.findByIdAndDelete(id);

    logger.info(`Contact message deleted: ${message.email}`);

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  },
);
