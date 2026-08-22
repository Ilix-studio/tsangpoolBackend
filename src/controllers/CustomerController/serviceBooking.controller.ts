import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import Branch from "../../models/Branch";

import { CustomerProfileModel } from "../../models/CustomerSystem/CustomerProfile";
import {
  canAccessBranch,
  getUserBranch,
  getUserRole,
  isBranchManager,
  isServiceAdmin,
} from "../../types/user.types";
import logger from "../../utils/logger";
import ServiceBookingModel from "../../models/CustomerSystem/ServiceBooking";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";
import { FREE_SERVICES, PAID_SERVICES } from "../../types/serviceBooking.types";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

/**
 * @desc    Get customer's vehicle model name for service booking
 * @route   GET /api/service-bookings/my-vehicle-info
 * @access  Private (Customer)
 */

export const getCustomerVehicleInfo = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const vehicle = await CustomerVehicleModel.findOne({
      customer: req.customer._id,
      isActive: true,
    });

    if (!vehicle) {
      res.status(404);
      throw new Error("No active vehicle found for this customer");
    }

    // Populate from the correct model based on stockType
    const populateModel =
      vehicle.stockType === "StockConceptCSV"
        ? "StockConceptCSV"
        : "StockConcept";

    await vehicle.populate({
      path: "stockConcept",
      model: populateModel,
      select:
        "modelName modelVariant category engineCC color variant yearOfManufacture",
    });

    const stock = vehicle.stockConcept as any;

    res.status(200).json({
      success: true,
      data: {
        vehicleId: vehicle._id,
        modelName: stock?.modelName ?? stock?.modelVariant ?? "Unknown Model",
      },
    });
  }
);

/**
 * @desc    Create a new service booking (authenticated customers only)
 * @route   POST /api/service-bookings
 * @access  Private (Customer)
 */
export const createServiceBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      vehicle,
      serviceType, // Single service only
      branch, // Branch reference
      appointmentDate,
      appointmentTime,
      location, // branch, home, office, roadside
    } = req.body;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    // Validate required fields
    if (
      !vehicle ||
      !serviceType ||
      !branch ||
      !appointmentDate ||
      !appointmentTime ||
      !location
    ) {
      res.status(400);
      throw new Error("Please provide all required fields");
    }

    // Validate service type exists in allowed services
    const allFreeServices = FREE_SERVICES.map((s) => s.id);
    const allPaidServices = PAID_SERVICES.map((s) => s.id);
    const allServices = [...allFreeServices, ...allPaidServices];

    if (!allServices.includes(serviceType)) {
      res.status(400);
      throw new Error(
        `Invalid service type: ${serviceType}. Please select a valid service.`
      );
    }

    if (allFreeServices.includes(serviceType) && req.customer.freeServicesDisabled) {
      res.status(403);
      throw new Error(
        "Free services are no longer available for this account."
      );
    }

    // Check if customer has already used this service
    const hasUsedService = await ServiceBookingModel.hasCustomerUsedService(
      req.customer._id.toString(),
      serviceType
    );

    if (hasUsedService) {
      res.status(400);
      throw new Error(
        "You have already used this service. Each service can only be booked once."
      );
    }

    // Validate vehicle belongs to customer
    if (!mongoose.Types.ObjectId.isValid(vehicle)) {
      res.status(400);
      throw new Error("Invalid vehicle ID");
    }

    const customerVehicle = await CustomerVehicleModel.findOne({
      _id: vehicle,
      customer: req.customer._id,
      isActive: true,
    }).populate("stockConcept");

    if (!customerVehicle) {
      res.status(404);
      throw new Error("Vehicle not found or doesn't belong to customer");
    }

    // Validate branch exists
    if (!mongoose.Types.ObjectId.isValid(branch)) {
      res.status(400);
      throw new Error("Invalid branch ID");
    }

    const branchDoc = await Branch.findById(branch);
    if (!branchDoc) {
      res.status(404);
      throw new Error("Branch not found");
    }

    // Validate appointment date is in the future
    const appointmentDateTime = new Date(appointmentDate);
    if (appointmentDateTime <= new Date()) {
      res.status(400);
      throw new Error("Appointment date must be in the future");
    }

    // Validate appointment time format and extract minutes
    const timeMatch = appointmentTime.match(
      /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/
    );
    if (!timeMatch) {
      res.status(400);
      throw new Error("Invalid time format. Use HH:MM format");
    }

    // Check availability with 20-minute buffer
    const isAvailable = await ServiceBookingModel.checkAvailabilityWithBuffer(
      branch,
      appointmentDateTime,
      appointmentTime,
      20 // 20-minute buffer
    );

    if (!isAvailable) {
      res.status(409);
      throw new Error(
        "Time slot is not available. Please choose a time at least 20 minutes apart from existing bookings."
      );
    }

    // Create the service booking
    const serviceBooking = await ServiceBookingModel.create({
      customer: req.customer._id,
      vehicle,
      serviceType,
      usedServices: [serviceType], // Track this service as used
      branch,
      appointmentDate: appointmentDateTime,
      appointmentTime,
      location,
    });

    // Send admin notification
    await serviceBooking.sendAdminNotification();

    // Push notification to the branch's Branch-Admins & Service-Admins
    notify(
      NotificationEvents.serviceBooking({
        branch,
        bookingId: String(serviceBooking._id),
        serviceType,
      }),
    ).catch((err) => logger.error(`serviceBooking notify failed: ${err}`));

    // Populate related data for response
    await serviceBooking.populate([
      { path: "customer", select: "phoneNumber firebaseUid" },
      {
        path: "vehicle",
        populate: {
          path: "stockConcept",
          model: "StockConcept",
        },
      },
      { path: "branch", select: "name address phone email" },
    ]);

    // Manually get customer profile
    const customerProfile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    const responseData = {
      ...serviceBooking.toObject(),
      customerProfile,
    };

    logger.info(
      `Service booking created: ${serviceBooking.bookingId} for customer ${req.customer._id}`
    );

    res.status(201).json({
      success: true,
      message: "Service booking created successfully",
      data: {
        bookingId: serviceBooking.bookingId,
        appointmentDateTime: serviceBooking.appointmentDateTime,
        branch: serviceBooking.branch,
        estimatedCost: serviceBooking.estimatedCost,
        serviceType: serviceBooking.serviceType,
        status: serviceBooking.status,
        customer: responseData.customer,
        customerProfile: responseData.customerProfile,
      },
    });
  }
);

/**
 * @desc    Get customer's service bookings
 * @route   GET /api/service-bookings/my-bookings
 * @access  Private (Customer)
 */
export const getCustomerBookings = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const {
      status,
      page = 1,
      limit = 10,
      sortBy = "appointmentDate",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query: any = { customer: req.customer._id };

    if (status) {
      query.status = status;
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort: any = {};
    sort[sortBy as string] = sortOrder === "desc" ? -1 : 1;

    // Execute query
    const total = await ServiceBookingModel.countDocuments(query);
    const bookings = await ServiceBookingModel.find(query)
      .populate([
        {
          path: "vehicle",
          populate: {
            path: "stockConcept",
            model: "StockConcept",
          },
        },
        { path: "branch", select: "name address phone" },
      ])
      .sort(sort)
      .limit(limitNum)
      .skip(skip);

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: bookings,
    });
  }
);

/**
 * @desc    Get all service bookings with filtering and pagination (Admin)
 * @route   GET /api/service-bookings
 * @access  Private (Admin only)
 */
export const getServiceBookings = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      status,
      branchId,
      startDate,
      endDate,
      serviceType,
      page = 1,
      limit = 10,
      sortBy = "appointmentDate",
      sortOrder = "asc",
    } = req.query;

    // Build query
    const query: any = {};

    // For Branch Managers, restrict to their branch only
    if (req.user && isBranchManager(req.user)) {
      const userBranch = getUserBranch(req.user);
      if (userBranch) {
        query.branch = userBranch;
      }
    }

    // For Service-Admins, restrict to their branch only
    if (req.user && isServiceAdmin(req.user)) {
      const userBranch = getUserBranch(req.user);
      logger.info(`ServiceAdmin branch scope: ${userBranch}, role: ${getUserRole(req.user)}, model: ${(req.user as any).constructor?.modelName}`);
      if (userBranch) {
        query.branch = userBranch;
      }
    }

    if (status) {
      query.status = status;
    }

    if (branchId) {
      if (!mongoose.Types.ObjectId.isValid(branchId as string)) {
        res.status(400);
        throw new Error("Invalid branch ID");
      }

      // Check if user can access this branch
      if (req.user && !canAccessBranch(req.user, branchId as string)) {
        res.status(403);
        throw new Error("Access denied to this branch");
      }

      query.branch = branchId;
    }

    if (serviceType) {
      query.serviceType = serviceType;
    }

    // Date range filter
    if (startDate || endDate) {
      query.appointmentDate = {};
      if (startDate) {
        query.appointmentDate.$gte = new Date(startDate as string);
      }
      if (endDate) {
        query.appointmentDate.$lte = new Date(endDate as string);
      }
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort: any = {};
    sort[sortBy as string] = sortOrder === "desc" ? -1 : 1;

    // Execute query
    const total = await ServiceBookingModel.countDocuments(query);
    const bookings = await ServiceBookingModel.find(query)
      .populate([
        { path: "customer", select: "phoneNumber firebaseUid" },
        {
          path: "vehicle",
          populate: {
            path: "stockConcept",
            model: "StockConcept",
          },
        },
        { path: "branch", select: "name address phone" },
      ])
      .sort(sort)
      .limit(limitNum)
      .skip(skip);

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: bookings,
    });
  }
);

/**
 * @desc    Get a single service booking by ID
 * @route   GET /api/service-bookings/:id
 * @access  Private (Customer for own bookings, Admin for all)
 */
export const getServiceBookingById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    let booking;

    // Check if it's a MongoDB ObjectId or booking ID
    if (mongoose.Types.ObjectId.isValid(id)) {
      booking = await ServiceBookingModel.findById(id);
    } else {
      // Search by booking ID (e.g., SB-20241201-0001)
      booking = await ServiceBookingModel.findOne({ bookingId: id });
    }

    if (!booking) {
      res.status(404);
      throw new Error("Service booking not found");
    }

    // Check access permissions
    if (req.customer) {
      // Customer can only access their own bookings
      if (booking.customer.toString() !== req.customer._id.toString()) {
        res.status(403);
        throw new Error("Access denied to this booking");
      }
    } else if (req.user) {
      // Admin access control
      if (isBranchManager(req.user)) {
        const userBranch = getUserBranch(req.user);
        if (userBranch && booking.branch.toString() !== userBranch.toString()) {
          res.status(403);
          throw new Error("Access denied to this booking");
        }
      }
      if (isServiceAdmin(req.user)) {
        const userBranch = getUserBranch(req.user);
        if (userBranch && booking.branch.toString() !== userBranch.toString()) {
          res.status(403);
          throw new Error("Access denied to this booking");
        }
      }
    } else {
      res.status(401);
      throw new Error("Authentication required");
    }

    // Populate related data
    await booking.populate([
      { path: "customer", select: "phoneNumber firebaseUid" },
      {
        path: "vehicle",
        populate: {
          path: "stockConcept",
          model: "StockConcept",
        },
      },
      { path: "branch", select: "name address phone email hours" },
    ]);

    res.status(200).json({
      success: true,
      data: booking,
    });
  }
);

/**
 * @desc    Update service booking status
 * @route   PATCH /api/service-bookings/:id/status
 * @access  Private (Admin only)
 */
export const updateBookingStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      status,
      assignedTechnician,
      serviceNotes,
      estimatedCost,
      actualCost,
      estimatedDuration,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid booking ID");
    }

    const booking = await ServiceBookingModel.findById(id);
    if (!booking) {
      res.status(404);
      throw new Error("Service booking not found");
    }

    // Check access permissions
    if (req.user && isBranchManager(req.user)) {
      const userBranch = getUserBranch(req.user);
      if (userBranch && booking.branch.toString() !== userBranch.toString()) {
        res.status(403);
        throw new Error("Access denied to this booking");
      }
    }
    if (req.user && isServiceAdmin(req.user)) {
      const userBranch = getUserBranch(req.user);
      if (userBranch && booking.branch.toString() !== userBranch.toString()) {
        res.status(403);
        throw new Error("Access denied to this booking");
      }
    }

    // Validate status transition
    const validStatuses = [
      "pending",
      "confirmed",
      "in-progress",
      "completed",
      "cancelled",
    ];
    if (status && !validStatuses.includes(status)) {
      res.status(400);
      throw new Error("Invalid status");
    }

    // Update fields
    if (status) booking.status = status;
    if (assignedTechnician) booking.assignedTechnician = assignedTechnician;
    if (serviceNotes) booking.serviceNotes = serviceNotes;
    if (estimatedCost) booking.estimatedCost = estimatedCost;
    if (actualCost) booking.actualCost = actualCost;
    if (estimatedDuration) booking.estimatedDuration = estimatedDuration;

    await booking.save();

    const userRole = req.user ? getUserRole(req.user) : "system";
    logger.info(
      `Service booking ${booking.bookingId} status updated to ${status} by ${userRole}`
    );

    res.status(200).json({
      success: true,
      message: "Booking status updated successfully",
      data: {
        bookingId: booking.bookingId,
        status: booking.status,
        updatedAt: booking.updatedAt,
      },
    });
  }
);

/**
 * @desc    Cancel a service booking
 * @route   DELETE /api/service-bookings/:id/cancel
 * @access  Private (Customer for own bookings, Admin for all)
 */
export const cancelServiceBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;

    let booking;

    // Find booking by ID or booking ID
    if (mongoose.Types.ObjectId.isValid(id)) {
      booking = await ServiceBookingModel.findById(id);
    } else {
      booking = await ServiceBookingModel.findOne({ bookingId: id });
    }

    if (!booking) {
      res.status(404);
      throw new Error("Service booking not found");
    }

    // Check access permissions
    if (req.customer) {
      // Customer can only cancel their own bookings
      if (booking.customer.toString() !== req.customer._id.toString()) {
        res.status(403);
        throw new Error("Access denied to this booking");
      }
    } else if (req.user) {
      // Admin access control
      if (isBranchManager(req.user)) {
        const userBranch = getUserBranch(req.user);
        if (userBranch && booking.branch.toString() !== userBranch.toString()) {
          res.status(403);
          throw new Error("Access denied to this booking");
        }
      }
      if (isServiceAdmin(req.user)) {
        const userBranch = getUserBranch(req.user);
        if (userBranch && booking.branch.toString() !== userBranch.toString()) {
          res.status(403);
          throw new Error("Access denied to this booking");
        }
      }
    } else {
      res.status(401);
      throw new Error("Authentication required");
    }

    // Check if booking can be cancelled
    if (booking.status === "completed") {
      res.status(400);
      throw new Error("Cannot cancel a completed booking");
    }

    if (booking.status === "cancelled") {
      res.status(400);
      throw new Error("Booking is already cancelled");
    }

    // Cancel the booking using the instance method
    await booking.cancelBooking(reason);

    logger.info(
      `Service booking ${booking.bookingId} cancelled. Reason: ${
        reason || "Not specified"
      }`
    );

    res.status(200).json({
      success: true,
      message: "Service booking cancelled successfully",
      data: {
        bookingId: booking.bookingId,
        status: booking.status,
        cancelledAt: booking.updatedAt,
      },
    });
  }
);

/**
 * @desc    Check time slot availability
 * @route   GET /api/service-bookings/availability
 * @access  Private (Customer)
 */
export const checkTimeSlotAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    const { branchId, date } = req.query;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    if (!branchId || !date) {
      res.status(400);
      throw new Error("Branch ID and date are required");
    }

    if (!mongoose.Types.ObjectId.isValid(branchId as string)) {
      res.status(400);
      throw new Error("Invalid branch ID");
    }

    const appointmentDate = new Date(date as string);
    if (appointmentDate <= new Date()) {
      res.status(400);
      throw new Error("Date must be in the future");
    }

    // Get available time slots using static method
    const availableSlots = await ServiceBookingModel.getAvailableTimeSlots(
      branchId as string,
      appointmentDate
    );

    res.status(200).json({
      success: true,
      data: {
        date: appointmentDate.toDateString(),
        availableSlots,
        totalAvailable: availableSlots.length,
      },
    });
  }
);

/**
 * @desc    Get upcoming appointments for a branch
 * @route   GET /api/service-bookings/branch/:branchId/upcoming
 * @access  Private (Branch Admin or Super Admin)
 */
export const getBranchUpcomingAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;
    const { days = 7 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      res.status(400);
      throw new Error("Invalid branch ID");
    }

    // Check access permissions
    if (req.user && !canAccessBranch(req.user, branchId)) {
      res.status(403);
      throw new Error("Access denied to this branch data");
    }

    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + parseInt(days as string));

    const appointments = await ServiceBookingModel.find({
      branch: branchId,
      appointmentDate: {
        $gte: today,
        $lte: futureDate,
      },
      status: { $in: ["pending", "confirmed", "in-progress"] },
    })
      .populate([
        { path: "customer", select: "phoneNumber firebaseUid" },
        {
          path: "vehicle",
          populate: {
            path: "stockConcept",
            model: "StockConcept",
          },
        },
        { path: "branch", select: "name" },
      ])
      .sort({ appointmentDate: 1, appointmentTime: 1 });

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments,
    });
  }
);

/**
 * @desc    Get booking statistics for dashboard
 * @route   GET /api/service-bookings/stats
 * @access  Private (Admin only)
 */
export const getBookingStats = asyncHandler(
  async (req: Request, res: Response) => {
    const { branchId, startDate, endDate } = req.query;

    // Build base query
    const baseQuery: any = {};

    // For Branch Managers, restrict to their branch
    if (req.user && isBranchManager(req.user)) {
      const userBranch = getUserBranch(req.user);
      if (userBranch) {
        baseQuery.branch = userBranch;
      }
    } else if (req.user && isServiceAdmin(req.user)) {
      const userBranch = getUserBranch(req.user);
      if (userBranch) {
        baseQuery.branch = userBranch;
      }
    } else if (branchId) {
      // For Super Admins, allow filtering by branch
      if (!mongoose.Types.ObjectId.isValid(branchId as string)) {
        res.status(400);
        throw new Error("Invalid branch ID");
      }
      baseQuery.branch = branchId;
    }

    // Date range filter
    if (startDate || endDate) {
      baseQuery.createdAt = {};
      if (startDate) {
        baseQuery.createdAt.$gte = new Date(startDate as string);
      }
      if (endDate) {
        baseQuery.createdAt.$lte = new Date(endDate as string);
      }
    }

    // Get various statistics
    const [
      totalBookings,
      statusStats,
      serviceTypeStats,
      revenueStats,
      monthlyTrend,
      notificationStats,
    ] = await Promise.all([
      // Total bookings
      ServiceBookingModel.countDocuments(baseQuery),

      // Bookings by status
      ServiceBookingModel.aggregate([
        { $match: baseQuery },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // Bookings by service type
      ServiceBookingModel.aggregate([
        { $match: baseQuery },
        { $group: { _id: "$serviceType", count: { $sum: 1 } } },
      ]),

      // Revenue statistics
      ServiceBookingModel.aggregate([
        { $match: { ...baseQuery, actualCost: { $exists: true } } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$actualCost" },
            averageBookingValue: { $avg: "$actualCost" },
            completedBookings: { $sum: 1 },
          },
        },
      ]),

      // Monthly trend
      ServiceBookingModel.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
            revenue: { $sum: { $ifNull: ["$actualCost", 0] } },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      // Notification statistics
      ServiceBookingModel.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            totalNotificationsSent: {
              $sum: { $cond: ["$adminNotificationSent", 1, 0] },
            },
            pendingNotifications: {
              $sum: { $cond: ["$adminNotificationSent", 0, 1] },
            },
          },
        },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalBookings,
        statusDistribution: statusStats,
        serviceTypeDistribution: serviceTypeStats,
        revenue: revenueStats[0] || {
          totalRevenue: 0,
          averageBookingValue: 0,
          completedBookings: 0,
        },
        monthlyTrend,
        notifications: notificationStats[0] || {
          totalNotificationsSent: 0,
          pendingNotifications: 0,
        },
      },
    });
  }
);

/**
 * @desc    Get customer service statistics
 * @route   GET /api/service-bookings/my-stats
 * @access  Private (Customer)
 */
export const getCustomerServiceStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    // Get total services used
    const totalServicesUsed = await ServiceBookingModel.getCustomerServiceCount(
      req.customer._id.toString()
    );

    // Get used services list
    const usedServices = await ServiceBookingModel.find({
      customer: req.customer._id,
      status: { $in: ["confirmed", "completed"] },
    }).select("serviceType");

    const usedServiceTypes = usedServices.map((booking) => booking.serviceType);

    // Calculate available services
    const allFreeServices = FREE_SERVICES.map((s) => s.id);
    const allPaidServices = PAID_SERVICES.map((s) => s.id);
    const allServices = [...allFreeServices, ...allPaidServices];

    const availableServices = allServices.filter((service) => {
      if (usedServiceTypes.includes(service)) return false;
      if (req.customer!.freeServicesDisabled && allFreeServices.includes(service)) {
        return false;
      }
      return true;
    });

    res.status(200).json({
      success: true,
      data: {
        totalServicesUsed,
        availableServicesCount: availableServices.length,
        usedServicesCount: usedServiceTypes.length,
        usedServiceTypes,
        availableServices,
        freeServicesDisabled: req.customer.freeServicesDisabled,
        breakdown: {
          freeServicesUsed: usedServiceTypes.filter((s) =>
            allFreeServices.includes(s)
          ).length,
          paidServicesUsed: usedServiceTypes.filter((s) =>
            allPaidServices.includes(s)
          ).length,
        },
      },
    });
  }
);
