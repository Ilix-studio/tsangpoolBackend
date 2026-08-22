import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import { JobCardModel } from "../../models/ServiceM/JobCard";
import { JobCardInvoiceModel } from "../../models/ServiceM/JobCardInvoice";
import ServiceBookingModel from "../../models/CustomerSystem/ServiceBooking";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";

import {
  isServiceAdmin,
  isAdmin,
  getUserBranch,
  canAccessBranch,
  extractBranchId,
} from "../../types/user.types";
import logger from "../../utils/logger";
import {
  CreateJobCardBody,
  AddLineItemBody,
  CustomerReviewBody,
  CancelJobCardBody,
  JobCardQueryFilters,
  ILineItem,
  JOB_CARD_STATUSES,
} from "../../types/jobCard.types";
import { BaseCustomerModel } from "../../models/CustomerSystem/BaseCustomer";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const IMMUTABLE_STATUSES = [
  "customer_confirmed",
  "invoice_generated",
  "closed",
  "cancelled",
];

function assertMutable(status: string, res: Response): boolean {
  if (IMMUTABLE_STATUSES.includes(status)) {
    res.status(403).json({
      success: false,
      message: `Job card cannot be modified in status '${status}'`,
    });
    return false;
  }
  return true;
}

function sanitizeForCustomer(jobCard: any): Record<string, any> {
  const obj = jobCard.toObject ? jobCard.toObject() : { ...jobCard };
  delete obj.internalNotes;
  if (obj.confirmation) {
    delete obj.confirmation.otpHash;
    delete obj.confirmation.otpExpiresAt;
  }
  return obj;
}

// ─── Create Job Card ──────────────────────────────────────────────────────────

/**
 * @desc    Open a new job card from a ServiceBooking or as a walk-in
 * @route   POST /api/job-cards
 * @access  Service-Admin
 */
export const createJobCard = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      serviceBookingId,
      customerId,
      vehicleId,
      priority,
      assignedTechnician,
      physicalChecklist,
      customerRequests,
      internalNotes,
    }: CreateJobCardBody = req.body;

    if (!req.user || !isServiceAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Service-Admin can open a job card");
    }

    const saUser = req.user as any;
    const saBranch: mongoose.Types.ObjectId =
      saUser.branch?._id ?? saUser.branch;

    let customer: mongoose.Types.ObjectId;
    let vehicle: mongoose.Types.ObjectId;
    let serviceType = "general";
    let resolvedBookingId: mongoose.Types.ObjectId | null = null;

    if (serviceBookingId) {
      // Query by human-readable bookingId field, not _id
      const booking = await ServiceBookingModel.findOne({
        bookingId: serviceBookingId,
      });
      console.log("listJobCards query:", JSON.stringify(booking));
      if (!booking) {
        res.status(404);
        throw new Error("Service booking not found");
      }
      if (booking.branch.toString() !== saBranch.toString()) {
        res.status(403);
        throw new Error("Service booking belongs to a different branch");
      }

      const existing = await JobCardModel.findOne({
        serviceBooking: booking._id,
        status: { $nin: ["cancelled"] },
      });
      if (existing) {
        res.status(409);
        throw new Error(
          `Active job card (${existing.jobCardNumber}) already exists for this booking`,
        );
      }

      customer = new mongoose.Types.ObjectId(booking.customer.toString());
      vehicle = new mongoose.Types.ObjectId(booking.vehicle.toString());
      serviceType = booking.serviceType;
      resolvedBookingId = new mongoose.Types.ObjectId(booking._id.toString());
    } else {
      if (!customerId || !vehicleId) {
        res.status(400);
        throw new Error(
          "customerId and vehicleId are required for walk-in job cards",
        );
      }
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        res.status(400);
        throw new Error("Invalid customer ID");
      }
      if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
        res.status(400);
        throw new Error("Invalid vehicle ID");
      }

      const customerDoc = await BaseCustomerModel.findById(customerId);
      if (!customerDoc) {
        res.status(404);
        throw new Error("Customer not found");
      }
      const vehicleDoc = await CustomerVehicleModel.findOne({
        _id: vehicleId,
        customer: customerId,
        isActive: true,
      });
      if (!vehicleDoc) {
        res.status(404);
        throw new Error("Active vehicle not found for this customer");
      }

      customer = new mongoose.Types.ObjectId(customerDoc._id.toString());
      vehicle = new mongoose.Types.ObjectId(vehicleDoc._id.toString());
    }

    const jobCard = await JobCardModel.create({
      serviceBooking: resolvedBookingId,
      customer,
      vehicle,
      branch: saBranch,
      openedBy: saUser._id,
      serviceType,
      priority: priority ?? "normal",
      assignedTechnician,
      physicalChecklist: physicalChecklist ?? {},
      customerRequests,
      internalNotes,
    });

    if (resolvedBookingId) {
      await ServiceBookingModel.findByIdAndUpdate(resolvedBookingId, {
        jobCard: jobCard._id,
        status: "confirmed",
      });
    }

    logger.info(
      `JobCard created: ${jobCard.jobCardNumber} by SA ${saUser.applicationId}`,
    );

    res.status(201).json({
      success: true,
      message: "Job card created successfully",
      data: jobCard,
    });
  },
);
// ─── List Job Cards ───────────────────────────────────────────────────────────

/**
 * @desc    List job cards with filters — branch-scoped for SA/BA
 * @route   GET /api/job-cards
 * @access  Service-Admin, Branch-Admin, Super-Admin
 */
export const listJobCards = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      status,
      branchId,
      customerId,
      startDate,
      endDate,
      priority,
      page = 1,
      limit = 20,
    } = req.query as unknown as JobCardQueryFilters;

    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }

    const query: Record<string, any> = {};

    if (isAdmin(req.user)) {
      if (branchId) query.branch = branchId;
    } else {
      const userBranch = getUserBranch(req.user);
      // getUserBranch returns a string (ObjectId) or null
      query.branch = userBranch;
    }

    if (status) query.status = status;
    if (customerId) query.customer = customerId;
    if (priority) query.priority = priority;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      JobCardModel.find(query)
        .select("-internalNotes -billVersions")
        .populate("customer", "phoneNumber")
        .populate("vehicle", "numberPlate")
        .populate("openedBy", "name applicationId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      JobCardModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data,
    });
  },
);

// ─── Get Single Job Card ──────────────────────────────────────────────────────

/**
 * @desc    Get full job card — SA sees everything, customer gets sanitized view
 * @route   GET /api/job-cards/:id
 * @access  Service-Admin, Branch-Admin, Super-Admin, Customer (owner)
 */
export const getJobCard = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid job card ID");
  }

  const jobCard = await JobCardModel.findById(id)
    .populate("customer", "phoneNumber firebaseUid")
    .populate({
      path: "vehicle",
      populate: { path: "stockConcept", select: "modelName color engineCC" },
    })
    .populate("branch", "branchName address phone")
    .populate("openedBy", "name applicationId")
    .populate("invoiceRef");

  if (!jobCard) {
    res.status(404);
    throw new Error("Job card not found");
  }

  if (req.customer) {
    const customerId =
      (jobCard.customer as any)._id?.toString() ?? jobCard.customer.toString();
    if (customerId !== req.customer._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
    const customerVisibleStatuses = [
      "temp_bill_sent",
      "customer_reviewed",
      "in_progress",
      "final_bill_sent",
      "customer_confirmed",
      "invoice_generated",
      "closed",
    ];
    if (!customerVisibleStatuses.includes(jobCard.status)) {
      res.status(403);
      throw new Error("Job card is not yet available for review");
    }
    res.status(200).json({ success: true, data: sanitizeForCustomer(jobCard) });
    return;
  }

  if (req.user) {
    const branchId =
      (jobCard.branch as any)._id?.toString() ?? jobCard.branch.toString();
    if (!canAccessBranch(req.user, branchId)) {
      res.status(403);
      throw new Error("Access denied: branch mismatch");
    }
    res.status(200).json({ success: true, data: jobCard });
    return;
  }

  res.status(401);
  throw new Error("Authentication required");
});

// ─── Add Line Item ────────────────────────────────────────────────────────────

/**
 * @desc    Add a catalog or free-text line item to a job card
 * @route   POST /api/job-cards/:id/line-items
 * @access  Service-Admin
 */
export const addLineItem = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body: AddLineItemBody = req.body;

  if (!req.user || !isServiceAdmin(req.user)) {
    res.status(403);
    throw new Error("Only Service-Admin can add line items");
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid job card ID");
  }

  const jobCard = await JobCardModel.findById(id);
  if (!jobCard) {
    res.status(404);
    throw new Error("Job card not found");
  }
  if (!assertMutable(jobCard.status, res)) return;

  const saUser = req.user as any;
  const saBranch = saUser.branch?._id ?? saUser.branch;
  if (jobCard.branch.toString() !== saBranch.toString()) {
    res.status(403);
    throw new Error("Branch mismatch");
  }

  if (!body.itemType || !body.name || !body.quantity || !body.unitPrice) {
    res.status(400);
    throw new Error("itemType, name, quantity, and unitPrice are required");
  }

  jobCard.lineItems.push({
    catalogRef: body.catalogRef
      ? new mongoose.Types.ObjectId(body.catalogRef)
      : null,
    itemType: body.itemType,
    name: body.name.trim(),
    description: body.description?.trim(),
    quantity: body.quantity,
    unitPrice: body.unitPrice,
    discount: body.discount ?? 0,
    taxRate: body.taxRate ?? 18,
    lineTotal: 0, // computed in pre-save
    addedBy: "service_admin",
    isRemoved: false,
  } as ILineItem);

  await jobCard.save();

  logger.info(
    `Line item '${body.name}' added to JobCard ${jobCard.jobCardNumber}`,
  );

  res
    .status(200)
    .json({ success: true, message: "Line item added", data: jobCard });
});

// ─── Remove Line Item (SA) ────────────────────────────────────────────────────

/**
 * @desc    Soft-remove a line item by SA
 * @route   DELETE /api/job-cards/:id/line-items/:itemId
 * @access  Service-Admin
 */
export const removeLineItem = asyncHandler(
  async (req: Request, res: Response) => {
    const { id, itemId } = req.params;

    if (!req.user || !isServiceAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Service-Admin can remove line items");
    }
    if (
      !mongoose.Types.ObjectId.isValid(id) ||
      !mongoose.Types.ObjectId.isValid(itemId)
    ) {
      res.status(400);
      throw new Error("Invalid ID");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (!assertMutable(jobCard.status, res)) return;

    const lineItems =
      jobCard.lineItems as unknown as mongoose.Types.DocumentArray<ILineItem>;
    const item = lineItems.id(itemId);
    if (!item) {
      res.status(404);
      throw new Error("Line item not found");
    }
    if (item.isRemoved) {
      res.status(400);
      throw new Error("Line item is already removed");
    }

    item.isRemoved = true;
    item.removedBy = "service_admin";
    await jobCard.save();

    res
      .status(200)
      .json({ success: true, message: "Line item removed", data: jobCard });
  },
);

// ─── Send Temp Bill ───────────────────────────────────────────────────────────

/**
 * @desc    Snapshot line items and push temp bill to customer dashboard
 * @route   PATCH /api/job-cards/:id/send-temp-bill
 * @access  Service-Admin
 */
export const sendTempBill = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.user || !isServiceAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Service-Admin can send a temp bill");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (!["draft", "customer_reviewed"].includes(jobCard.status)) {
      res.status(400);
      throw new Error(`Cannot send temp bill from status '${jobCard.status}'`);
    }
    if (jobCard.lineItems.filter((i) => !i.isRemoved).length === 0) {
      res.status(400);
      throw new Error("Cannot send temp bill with no active line items");
    }

    const saUser = req.user as any;
    jobCard.snapshotBill(saUser._id, "temp");
    jobCard.status = "temp_bill_sent";
    jobCard.tempBillSentAt = new Date();
    await jobCard.save();

    // TODO: emit notification to customer dashboard
    logger.info(`Temp bill sent for JobCard ${jobCard.jobCardNumber}`);

    res.status(200).json({
      success: true,
      message: "Temp bill sent to customer",
      data: sanitizeForCustomer(jobCard),
    });
  },
);

// ─── Customer Review ──────────────────────────────────────────────────────────

/**
 * @desc    Customer soft-removes items from temp bill and sends back
 * @route   PATCH /api/job-cards/:id/customer-review
 * @access  Customer (owner)
 */
export const customerReview = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { removedLineItemIds, additionalRequests }: CustomerReviewBody =
      req.body;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (jobCard.customer.toString() !== req.customer._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
    if (jobCard.status !== "temp_bill_sent") {
      res.status(400);
      throw new Error(
        "Customer review is only allowed in 'temp_bill_sent' status",
      );
    }

    if (Array.isArray(removedLineItemIds)) {
      const lineItems =
        jobCard.lineItems as unknown as mongoose.Types.DocumentArray<ILineItem>;
      for (const itemId of removedLineItemIds) {
        if (!mongoose.Types.ObjectId.isValid(itemId)) continue;
        const item = lineItems.id(itemId);
        if (item && !item.isRemoved) {
          item.isRemoved = true;
          item.removedBy = "customer";
        }
      }
    }

    if (additionalRequests?.trim()) {
      jobCard.customerRequests = jobCard.customerRequests
        ? `${jobCard.customerRequests}\n[Customer update]: ${additionalRequests.trim()}`
        : additionalRequests.trim();
    }

    jobCard.status = "customer_reviewed";
    jobCard.customerReviewedAt = new Date();
    await jobCard.save();

    logger.info(`Customer reviewed JobCard ${jobCard.jobCardNumber}`);

    res.status(200).json({
      success: true,
      message: "Review submitted",
      data: sanitizeForCustomer(jobCard),
    });
  },
);

// ─── Acknowledge Review ───────────────────────────────────────────────────────

/**
 * @desc    SA acknowledges customer review — moves to in_progress
 * @route   PATCH /api/job-cards/:id/acknowledge
 * @access  Service-Admin
 */
export const acknowledgeReview = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.user || !isServiceAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Service-Admin can acknowledge reviews");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (jobCard.status !== "customer_reviewed") {
      res.status(400);
      throw new Error("Can only acknowledge from 'customer_reviewed' status");
    }

    jobCard.status = "in_progress";
    jobCard.inProgressAt = new Date();
    await jobCard.save();

    res.status(200).json({
      success: true,
      message: "Job card moved to in-progress",
      data: jobCard,
    });
  },
);

// ─── Send Final Bill ──────────────────────────────────────────────────────────

/**
 * @desc    SA completes work and sends final bill to customer
 * @route   PATCH /api/job-cards/:id/send-final-bill
 * @access  Service-Admin
 */
export const sendFinalBill = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { internalNotes } = req.body;

    if (!req.user || !isServiceAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Service-Admin can send the final bill");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }

    const validPrior = ["in_progress", "draft", "customer_reviewed"];
    if (!validPrior.includes(jobCard.status)) {
      res.status(400);
      throw new Error(`Cannot send final bill from status '${jobCard.status}'`);
    }
    if (jobCard.lineItems.filter((i) => !i.isRemoved).length === 0) {
      res.status(400);
      throw new Error("Cannot send final bill with no active line items");
    }

    if (internalNotes?.trim()) jobCard.internalNotes = internalNotes.trim();

    const saUser = req.user as any;
    jobCard.snapshotBill(saUser._id, "final");
    jobCard.status = "final_bill_sent";
    jobCard.finalBillSentAt = new Date();
    await jobCard.save();

    // TODO: emit notification to customer dashboard
    logger.info(`Final bill sent for JobCard ${jobCard.jobCardNumber}`);

    res.status(200).json({
      success: true,
      message: "Final bill sent to customer",
      data: sanitizeForCustomer(jobCard),
    });
  },
);

// ─── Request OTP ──────────────────────────────────────────────────────────────

/**
 * @desc    Customer requests a 6-digit OTP to confirm the final bill
 * @route   POST /api/job-cards/:id/confirm/request-otp
 * @access  Customer (owner)
 */
export const requestConfirmationOtp = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const jobCard = await JobCardModel.findById(id).select(
      "+confirmation.otpHash +confirmation.otpExpiresAt",
    );
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (jobCard.customer.toString() !== req.customer._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
    if (jobCard.status !== "final_bill_sent") {
      res.status(400);
      throw new Error(
        "OTP can only be requested when the final bill is pending",
      );
    }

    const otp = generateOtp();
    const salt = await bcrypt.genSalt(10);
    jobCard.confirmation.otpHash = await bcrypt.hash(otp, salt);
    jobCard.confirmation.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    jobCard.confirmation.otpAttempts = 0;
    jobCard.confirmation.method = "otp";
    await jobCard.save();

    // TODO: send OTP via SMS to req.customer.phoneNumber
    logger.info(
      `OTP generated for JobCard ${jobCard.jobCardNumber} — customer ${req.customer._id}`,
    );

    res.status(200).json({
      success: true,
      message: "OTP sent to your registered phone number",
      // Raw OTP only exposed in development — never in production
      ...(process.env.NODE_ENV === "development" && { otp }),
    });
  },
);

// ─── Verify OTP ───────────────────────────────────────────────────────────────

/**
 * @desc    Customer submits OTP to confirm the final bill
 * @route   POST /api/job-cards/:id/confirm/verify-otp
 * @access  Customer (owner)
 */
export const verifyConfirmationOtp = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { otp } = req.body;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }
    if (!otp || typeof otp !== "string") {
      res.status(400);
      throw new Error("OTP is required");
    }

    const jobCard = await JobCardModel.findById(id).select(
      "+confirmation.otpHash +confirmation.otpExpiresAt",
    );
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (jobCard.customer.toString() !== req.customer._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
    if (jobCard.status !== "final_bill_sent") {
      res.status(400);
      throw new Error("No pending final bill to confirm");
    }

    const conf = jobCard.confirmation;

    if (conf.otpAttempts >= 3) {
      res.status(429);
      throw new Error("Maximum OTP attempts exceeded. Request a new OTP.");
    }
    if (!conf.otpHash || !conf.otpExpiresAt) {
      res.status(400);
      throw new Error("No OTP has been generated. Request an OTP first.");
    }
    if (new Date() > conf.otpExpiresAt) {
      res.status(400);
      throw new Error("OTP has expired. Request a new one.");
    }

    const isMatch = await bcrypt.compare(otp, conf.otpHash);
    conf.otpAttempts += 1;

    if (!isMatch) {
      await jobCard.save();
      res.status(400);
      throw new Error(
        `Invalid OTP. ${3 - conf.otpAttempts} attempt${3 - conf.otpAttempts === 1 ? "" : "s"} remaining.`,
      );
    }

    conf.confirmedAt = new Date();
    conf.confirmedVia = "otp";
    conf.otpHash = undefined;
    jobCard.status = "customer_confirmed";
    await jobCard.save();

    const invoice = await generateInvoice(jobCard);
    logger.info(
      `JobCard ${jobCard.jobCardNumber} confirmed via OTP — Invoice ${invoice.invoiceNumber}`,
    );

    res.status(200).json({
      success: true,
      message: "Bill confirmed. Invoice generated.",
      data: { invoice },
    });
  },
);

// ─── Confirm via Button ───────────────────────────────────────────────────────

/**
 * @desc    Customer confirms final bill via button (OTP fallback)
 * @route   POST /api/job-cards/:id/confirm/button
 * @access  Customer (owner)
 */
export const confirmViaButton = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }
    if (jobCard.customer.toString() !== req.customer._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
    if (jobCard.status !== "final_bill_sent") {
      res.status(400);
      throw new Error("No pending final bill to confirm");
    }

    jobCard.confirmation.confirmedAt = new Date();
    jobCard.confirmation.confirmedVia = "button";
    jobCard.confirmation.method = "button";
    jobCard.status = "customer_confirmed";
    await jobCard.save();

    const invoice = await generateInvoice(jobCard);
    logger.info(
      `JobCard ${jobCard.jobCardNumber} confirmed via button — Invoice ${invoice.invoiceNumber}`,
    );

    res.status(200).json({
      success: true,
      message: "Bill confirmed. Invoice generated.",
      data: { invoice },
    });
  },
);

// ─── Get Invoice ──────────────────────────────────────────────────────────────

/**
 * @desc    Retrieve the invoice for a job card
 * @route   GET /api/job-cards/:id/invoice
 * @access  Service-Admin, Branch-Admin, Super-Admin, Customer (owner)
 */
export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid job card ID");
  }

  const jobCard = await JobCardModel.findById(id).select(
    "invoiceRef customer branch",
  );
  if (!jobCard) {
    res.status(404);
    throw new Error("Job card not found");
  }

  if (req.customer) {
    if (jobCard.customer.toString() !== req.customer._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
  } else if (req.user) {
  if (!canAccessBranch(req.user, extractBranchId(jobCard.branch))) {
      res.status(403);
      throw new Error("Access denied: branch mismatch");
    }
  } else {
    res.status(401);
    throw new Error("Authentication required");
  }

  if (!jobCard.invoiceRef) {
    res.status(404);
    throw new Error("Invoice not yet generated");
  }

  const invoice = await JobCardInvoiceModel.findById(jobCard.invoiceRef)
    .populate("branch", "branchName address phone email")
    .populate("customer", "phoneNumber")
    .populate("vehicle", "numberPlate");

  if (!invoice) {
    res.status(404);
    throw new Error("Invoice record not found");
  }

  res.status(200).json({ success: true, data: invoice });
});

// ─── Cancel Job Card ──────────────────────────────────────────────────────────

/**
 * @desc    Cancel a job card — allowed before customer_confirmed
 * @route   DELETE /api/job-cards/:id
 * @access  Service-Admin
 */
export const cancelJobCard = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { cancellationReason }: CancelJobCardBody = req.body;

    if (!req.user || !isServiceAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Service-Admin can cancel a job card");
    }
    if (!cancellationReason?.trim()) {
      res.status(400);
      throw new Error("Cancellation reason is required");
    }

    const jobCard = await JobCardModel.findById(id);
    if (!jobCard) {
      res.status(404);
      throw new Error("Job card not found");
    }

    const nonCancellable = [
      "customer_confirmed",
      "invoice_generated",
      "closed",
      "cancelled",
    ];
    if (nonCancellable.includes(jobCard.status)) {
      res.status(400);
      throw new Error(`Cannot cancel a job card in status '${jobCard.status}'`);
    }

    jobCard.status = "cancelled";
    jobCard.cancelledAt = new Date();
    jobCard.cancellationReason = cancellationReason.trim();
    await jobCard.save();

    logger.info(
      `JobCard ${jobCard.jobCardNumber} cancelled: ${cancellationReason}`,
    );

    res.status(200).json({
      success: true,
      message: "Job card cancelled",
      data: jobCard,
    });
  },
);

// ─── Internal: Generate Invoice ───────────────────────────────────────────────

async function generateInvoice(jobCard: any) {
  const confirmedAt: Date = jobCard.confirmation.confirmedAt;
  const customerId = jobCard.customer.toString();

  const signatureToken = crypto
    .createHash("sha256")
    .update(
      `${jobCard._id.toString()}:${confirmedAt.toISOString()}:${customerId}`,
    )
    .digest("hex");

  const invoice = await JobCardInvoiceModel.create({
    jobCard: jobCard._id,
    branch: jobCard.branch,
    customer: jobCard.customer,
    vehicle: jobCard.vehicle,
    lineItemsSnapshot: jobCard.lineItems.filter((i: ILineItem) => !i.isRemoved),
    subtotal: jobCard.subtotal,
    taxTotal: jobCard.taxTotal,
    grandTotal: jobCard.grandTotal,
    digitalSignatureToken: signatureToken,
    issuedAt: confirmedAt,
    pdfUrl: null,
    notifiedSuperAdmin: false,
    notifiedServiceAdmin: false,
  });

  // Flip status and back-link atomically
  jobCard.status = "invoice_generated";
  jobCard.invoiceRef = invoice._id;
  await jobCard.save();

  // Mark notifications + fire real push to Super-Admin & the branch's Service-Admins
  await JobCardInvoiceModel.findByIdAndUpdate(invoice._id, {
    notifiedSuperAdmin: true,
    notifiedServiceAdmin: true,
  });

  notify(
    NotificationEvents.jobCardInvoice({
      branch: jobCard.branch,
      invoiceId: String(invoice._id),
      grandTotal: jobCard.grandTotal,
    }),
  ).catch((err) => logger.error(`jobCardInvoice notify failed: ${err}`));

  // PDF generation is async — Cloudinary upload would update pdfUrl here
  // TODO: enqueue PDF generation job

  return invoice;
}

/**
 * @desc    Monthly revenue stats from invoices — Super-Admin only
 * @route   GET /api/job-cards/stats/revenue
 * @access  Super-Admin
 */
export const getRevenueStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user)) {
      res.status(403);
      throw new Error("Super-Admin only");
    }

    const { year = new Date().getFullYear(), branchId } = req.query;

    const matchStage: Record<string, any> = {
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${Number(year) + 1}-01-01`),
      },
    };
    if (branchId) matchStage.branch = new mongoose.Types.ObjectId(branchId as string);

    const monthly = await JobCardInvoiceModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          revenue: { $sum: "$grandTotal" },
          subtotal: { $sum: "$subtotal" },
          taxTotal: { $sum: "$taxTotal" },
          invoiceCount: { $sum: 1 },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

    const totals = await JobCardInvoiceModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$grandTotal" },
          totalTax: { $sum: "$taxTotal" },
          totalInvoices: { $sum: 1 },
          avgInvoiceValue: { $avg: "$grandTotal" },
        },
      },
    ]);

    // Fill all 12 months — missing months get 0
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthlyFilled = MONTHS.map((label, i) => {
      const found = monthly.find((m) => m._id.month === i + 1);
      return {
        month: label,
        revenue: found?.revenue ?? 0,
        subtotal: found?.subtotal ?? 0,
        taxTotal: found?.taxTotal ?? 0,
        invoiceCount: found?.invoiceCount ?? 0,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        year: Number(year),
        monthly: monthlyFilled,
        totals: totals[0] ?? {
          totalRevenue: 0,
          totalTax: 0,
          totalInvoices: 0,
          avgInvoiceValue: 0,
        },
      },
    });
  },
);

/**
 * @desc    Job-card counts grouped by status — a branch-scoped lifecycle
 *          snapshot (not a time series) for Service-Admin dashboards.
 * @route   GET /api/job-cards/stats/status
 * @access  Super-Admin (all or ?branchId=), Branch-Admin, Service-Admin (own branch)
 */
export const getJobCardStatusStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }

    const { branchId } = req.query;
    const query: Record<string, any> = {};

    if (isAdmin(req.user)) {
      if (branchId) {
        query.branch = new mongoose.Types.ObjectId(branchId as string);
      }
    } else {
      const userBranch = getUserBranch(req.user);
      if (!userBranch) {
        res.status(400);
        throw new Error("Branch could not be resolved");
      }
      query.branch = new mongoose.Types.ObjectId(userBranch);
    }

    const counts = await JobCardModel.aggregate([
      { $match: query },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const byStatus = JOB_CARD_STATUSES.map((status) => ({
      status,
      count: counts.find((c) => c._id === status)?.count ?? 0,
    }));

    const total = byStatus.reduce((sum, s) => sum + s.count, 0);
    const closedCount =
      byStatus.find((s) => s.status === "closed")?.count ?? 0;
    const cancelledCount =
      byStatus.find((s) => s.status === "cancelled")?.count ?? 0;
    const openCount = total - closedCount - cancelledCount;

    res.status(200).json({
      success: true,
      data: { total, openCount, closedCount, cancelledCount, byStatus },
    });
  },
);