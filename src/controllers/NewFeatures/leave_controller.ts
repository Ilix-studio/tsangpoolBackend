// controllers/leave_controller.ts
import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import LeaveApplication, {
  ApplicantModel,
} from "../../models/NewFeatures/LeaveApplication";
import Admin from "../../models/Admin";
import Branch from "../../models/Branch";
import { sendLeaveNotificationEmail } from "../../utils/emailService";
import logger from "../../utils/logger";
import {
  isAdmin,
  isBranchManager,
  getUserBranch,
} from "../../types/user.types";
import { LEAVE_LIMITS, LeaveBalanceResult } from "../../types/leave_types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Every role that can apply for leave needs an entry here, a matching
// `enum` member on LeaveApplication.applicantModel, and the role listed on the
// applicant routes in routes/NewFeatures/leave_routes.ts — all three, or the
// request fails at whichever layer was missed.
const APPLICANT_MODEL_MAP: Record<string, ApplicantModel> = {
  "Branch-Admin": "BranchManager",
  "Service-Admin": "ServiceAdmin",
  "Part-Admin": "PartAdmin",
  Staff: "Staff",
};

function getApplicantModel(role: string): ApplicantModel {
  const model = APPLICANT_MODEL_MAP[role];
  if (!model)
    throw Object.assign(new Error("Invalid applicant role"), {
      statusCode: 403,
    });
  return model;
}

function calcBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

async function getUsedDays(
  applicantId: mongoose.Types.ObjectId,
  leaveType: string,
  year: number,
): Promise<number> {
  const result = await LeaveApplication.aggregate([
    {
      $match: {
        applicantId,
        leaveType,
        year,
        status: "Approved",
      },
    },
    { $group: { _id: null, total: { $sum: "$totalDays" } } },
  ]);
  return result[0]?.total ?? 0;
}

// ─── Apply for Leave ──────────────────────────────────────────────────────────

/**
 * @desc    Apply for leave
 * @route   POST /api/leaves/apply
 * @access  Branch-Admin, Service-Admin, Part-Admin, Staff
 */
export const applyLeave = asyncHandler(async (req: Request, res: Response) => {
  const { leaveType, startDate, endDate, reason } = req.body;

  if (!leaveType || !startDate || !endDate || !reason) {
    res.status(400);
    throw new Error("leaveType, startDate, endDate, and reason are required");
  }

  if (!["Sick", "Casual"].includes(leaveType)) {
    res.status(400);
    throw new Error("leaveType must be Sick or Casual");
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400);
    throw new Error("Invalid date format");
  }

  if (start > end) {
    res.status(400);
    throw new Error("startDate cannot be after endDate");
  }

  // Block future applications beyond 90 days
  const maxFutureDate = new Date();
  maxFutureDate.setDate(maxFutureDate.getDate() + 90);
  if (start > maxFutureDate) {
    res.status(400);
    throw new Error("Cannot apply more than 90 days in advance");
  }

  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const userRole = (req.user as any).role ?? "Branch-Admin";
  const applicantModel = getApplicantModel(userRole);
  const applicantId = req.user._id as mongoose.Types.ObjectId;
  const branchId = getUserBranch(req.user);

  if (!branchId) {
    res.status(400);
    throw new Error("User branch not found");
  }

  const year = start.getFullYear();
  const totalDays = calcBusinessDays(start, end);

  if (totalDays < 1) {
    res.status(400);
    throw new Error("Leave period contains no business days");
  }

  // Check balance
  const usedDays = await getUsedDays(applicantId, leaveType, year);
  const limit = LEAVE_LIMITS[leaveType as keyof typeof LEAVE_LIMITS];
  const remaining = limit - usedDays;

  if (totalDays > remaining) {
    res.status(400);
    throw new Error(
      `Insufficient ${leaveType} leave balance. Remaining: ${remaining} day(s), requested: ${totalDays}`,
    );
  }

  // Check for overlapping pending/approved applications
  const overlap = await LeaveApplication.findOne({
    applicantId,
    status: { $in: ["Pending", "Approved"] },
    $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }],
  });

  if (overlap) {
    res.status(409);
    throw new Error(
      "You have an overlapping leave application for this period",
    );
  }

  const application = await LeaveApplication.create({
    applicantId,
    applicantModel,
    applicantRole: userRole,
    branch: branchId,
    leaveType,
    startDate: start,
    endDate: end,
    totalDays,
    reason,
    status: "Pending",
    year,
  });

  // Notify Super-Admin (fire-and-forget)
  const superAdmin = await Admin.findOne({ isActive: true }).select("email");
  if (superAdmin) {
    const branch = await Branch.findById(branchId).select("branchName");
    sendLeaveNotificationEmail({
      superAdminEmail: superAdmin.email,
      applicantName: (req.user as any).name,
      applicantRole: userRole,
      branchName: branch?.branchName ?? "N/A",
      leaveType,
      startDate: start.toDateString(),
      endDate: end.toDateString(),
      totalDays,
      reason,
      applicationId: (application._id as any).toString(),
    }).catch((err) => logger.error("Leave notification email failed:", err));
  }

  logger.info(
    `Leave application submitted: ${application._id as any} by ${applicantId}`,
  );

  res.status(201).json({
    success: true,
    message: "Leave application submitted successfully",
    data: application,
  });
});

// ─── Get My Applications ─────────────────────────────────────────────────────

/**
 * @desc    Get logged-in user's leave applications
 * @route   GET /api/leaves/my
 * @access  Branch-Admin, Service-Admin, Part-Admin, Staff
 */
export const getMyLeaves = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { status, year } = req.query;
  const filter: Record<string, unknown> = {
    applicantId: req.user._id as mongoose.Types.ObjectId,
  };

  if (status) filter.status = status;
  if (year) filter.year = Number(year);

  const applications = await LeaveApplication.find(filter)
    .populate("branch", "branchName")
    .sort({ createdAt: -1 });

  res
    .status(200)
    .json({ success: true, count: applications.length, data: applications });
});

// ─── Get Leave Balance ────────────────────────────────────────────────────────

/**
 * @desc    Get logged-in user's leave balance for a year
 * @route   GET /api/leaves/balance?year=2025
 * @access  Branch-Admin, Service-Admin, Part-Admin, Staff
 */
export const getLeaveBalance = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const year = req.query.year
      ? Number(req.query.year)
      : new Date().getFullYear();
    const applicantId = req.user._id as mongoose.Types.ObjectId;

    const [sickUsed, casualUsed] = await Promise.all([
      getUsedDays(applicantId as mongoose.Types.ObjectId, "Sick", year),
      getUsedDays(applicantId as mongoose.Types.ObjectId, "Casual", year),
    ]);

    const balance: LeaveBalanceResult = {
      Sick: {
        total: LEAVE_LIMITS.Sick,
        used: sickUsed,
        remaining: LEAVE_LIMITS.Sick - sickUsed,
      },
      Casual: {
        total: LEAVE_LIMITS.Casual,
        used: casualUsed,
        remaining: LEAVE_LIMITS.Casual - casualUsed,
      },
    };

    res.status(200).json({ success: true, data: { year, balance } });
  },
);

// ─── Cancel Leave ─────────────────────────────────────────────────────────────

/**
 * @desc    Cancel own pending leave application
 * @route   PATCH /api/leaves/:id/cancel
 * @access  Branch-Admin, Service-Admin, Part-Admin, Staff
 */
export const cancelLeave = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid application ID");
  }

  const application = await LeaveApplication.findById(id);
  if (!application) {
    res.status(404);
    throw new Error("Leave application not found");
  }

  if (application.applicantId.toString() !== (req.user._id as any).toString()) {
    res.status(403);
    throw new Error("You can only cancel your own applications");
  }

  if (application.status !== "Pending") {
    res.status(400);
    throw new Error(`Cannot cancel a ${application.status} application`);
  }

  application.status = "Cancelled";
  await application.save();

  res.status(200).json({
    success: true,
    message: "Leave application cancelled",
    data: application,
  });
});

// ─── Review Leave (Super-Admin) ───────────────────────────────────────────────

/**
 * @desc    Approve or Reject a leave application
 * @route   PATCH /api/leaves/:id/review
 * @access  Super-Admin
 */
export const reviewLeave = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { status, reviewNote } = req.body;

  if (!["Approved", "Rejected"].includes(status)) {
    res.status(400);
    throw new Error("status must be Approved or Rejected");
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid application ID");
  }

  const application = await LeaveApplication.findById(id);
  if (!application) {
    res.status(404);
    throw new Error("Leave application not found");
  }

  if (application.status !== "Pending") {
    res.status(400);
    throw new Error(`Application is already ${application.status}`);
  }

  // Re-validate balance on approval to guard against race conditions
  if (status === "Approved") {
    const usedDays = await getUsedDays(
      application.applicantId,
      application.leaveType,
      application.year,
    );
    const limit = LEAVE_LIMITS[application.leaveType];
    if (usedDays + application.totalDays > limit) {
      res.status(400);
      throw new Error(
        `Approving this would exceed the ${application.leaveType} leave limit for ${application.year}`,
      );
    }
  }

  application.status = status;
  application.reviewedBy = req.user._id as mongoose.Types.ObjectId;
  application.reviewNote = reviewNote;
  application.reviewedAt = new Date();
  await application.save();

  logger.info(
    `Leave ${application._id} ${status} by Super-Admin ${req.user._id as mongoose.Types.ObjectId}`,
  );

  res.status(200).json({
    success: true,
    message: `Leave application ${status}`,
    data: application,
  });
});

// ─── Get All Applications (Super-Admin) ──────────────────────────────────────

/**
 * @desc    Get all leave applications with filters
 * @route   GET /api/leaves
 * @access  Super-Admin
 */
export const getAllLeaves = asyncHandler(
  async (req: Request, res: Response) => {
    const { status, leaveType, branch, year, page = 1, limit = 20 } = req.query;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (leaveType) filter.leaveType = leaveType;
    if (branch && mongoose.Types.ObjectId.isValid(branch as string))
      filter.branch = branch;
    if (year) filter.year = Number(year);

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      LeaveApplication.find(filter)
        .populate("applicantId", "name email applicationId")
        .populate("branch", "branchName")
        .populate("reviewedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      LeaveApplication.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data,
    });
  },
);
