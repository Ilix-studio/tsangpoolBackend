// controllers/enquiry.controller.ts
import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import logger from "../../utils/logger";
import EnquiryModel from "../../models/EnquiryForm";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

/**
 * @desc    Create a new enquiry
 * @route   POST /api/enquiry-form
 * @access  Public
 */
export const createEnquiry = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, phoneNumber, address } = req.body;

    // Validate required fields
    if (!name || !phoneNumber || !address) {
      res.status(400);
      throw new Error("Please provide all required fields");
    }

    // Validate address fields
    if (
      !address.village ||
      !address.district ||
      !address.state ||
      !address.pinCode
    ) {
      res.status(400);
      throw new Error("Please provide all address fields");
    }

    // Validate phone number format
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      res.status(400);
      throw new Error("Please provide a valid 10-digit phone number");
    }

    // Create new enquiry
    const enquiry = await EnquiryModel.create({
      name,
      phoneNumber,
      address,
      status: "new",
    });

    logger.info(`New enquiry submitted: ${enquiry._id} by ${enquiry.name}`);

    notify(NotificationEvents.enquiry({ name: enquiry.name })).catch((err) =>
      logger.error(`enquiry notify failed: ${err}`),
    );

    res.status(201).json({
      success: true,
      data: enquiry,
      message: "Enquiry submitted successfully. We will contact you shortly.",
    });
  },
);

/**
 * @desc    Get all enquiries
 * @route   GET /api/enquiry-form
 * @access  Private (Admin only)
 */
export const getAllEnquiries = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query object
    const query: any = {};

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Search functionality
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      query.$or = [
        { name: searchRegex },
        { phoneNumber: searchRegex },
        { "address.village": searchRegex },
        { "address.district": searchRegex },
        { "address.state": searchRegex },
        { "address.pinCode": searchRegex },
      ];
    }

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === "desc" ? -1 : 1;

    // Get total count for pagination
    const total = await EnquiryModel.countDocuments(query);

    // Execute query with pagination and sorting
    const enquiries = await EnquiryModel.find(query)
      .sort(sort)
      .limit(Number(limit))
      .skip(skip);

    res.status(200).json({
      success: true,
      count: enquiries.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data: enquiries,
    });
  },
);

/**
 * @desc    Get enquiry by ID
 * @route   GET /api/enquiry-form/:id
 * @access  Private (Admin only)
 */
export const getEnquiryById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid enquiry ID");
    }

    const enquiry = await EnquiryModel.findById(id);

    if (!enquiry) {
      res.status(404);
      throw new Error("Enquiry not found");
    }

    res.status(200).json({
      success: true,
      data: enquiry,
    });
  },
);

/**
 * @desc    Delete enquiry
 * @route   DELETE /api/enquiry-form/:id
 * @access  Private (Super-Admin only)
 */
export const deleteEnquiry = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid enquiry ID");
    }

    const enquiry = await EnquiryModel.findById(id);

    if (!enquiry) {
      res.status(404);
      throw new Error("Enquiry not found");
    }

    await EnquiryModel.findByIdAndDelete(id);

    logger.info(`Enquiry deleted: ${id} by admin ${req.user?.id}`);

    res.status(200).json({
      success: true,
      message: "Enquiry deleted successfully",
    });
  },
);

/**
 * @desc    Get enquiry statistics
 * @route   GET /api/enquiry-form/stats
 * @access  Private (Admin only)
 */
export const getEnquiryStats = asyncHandler(
  async (req: Request, res: Response) => {
    // Get counts by status
    const statusCounts = await EnquiryModel.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get counts by state
    const stateCounts = await EnquiryModel.aggregate([
      {
        $group: {
          _id: "$address.state",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    // Get counts by district
    const districtCounts = await EnquiryModel.aggregate([
      {
        $group: {
          _id: "$address.district",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    // Get total enquiries
    const totalEnquiries = await EnquiryModel.countDocuments();

    // Get enquiries submitted today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const enquiriesToday = await EnquiryModel.countDocuments({
      createdAt: { $gte: today },
    });

    // Get enquiries submitted in the last 7 days
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const enquiriesLastWeek = await EnquiryModel.countDocuments({
      createdAt: { $gte: lastWeek },
    });

    // Get enquiries submitted in the last 30 days
    const lastMonth = new Date();
    lastMonth.setDate(lastMonth.getDate() - 30);
    const enquiriesLastMonth = await EnquiryModel.countDocuments({
      createdAt: { $gte: lastMonth },
    });

    res.status(200).json({
      success: true,
      data: {
        totalEnquiries,
        enquiriesToday,
        enquiriesLastWeek,
        enquiriesLastMonth,
        statusCounts: statusCounts.reduce((acc: any, curr: any) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        topStates: stateCounts,
        topDistricts: districtCounts,
      },
    });
  },
);
