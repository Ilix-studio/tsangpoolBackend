// controllers/accidentReport.controller.ts
import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import crypto from "crypto";

import ErrorResponse from "../../utils/errorResponse";
import AccidentReportModel from "../../models/AdminFeatures/AccidentReport";

// AR-XXXX-XXXX
const generateReportId = (): string => {
  const a = crypto.randomBytes(2).toString("hex").toUpperCase();
  const b = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `AR-${a}-${b}`;
};

// ─── CUSTOMER ────────────────────────────────────────────────────────────────

/**
 * POST /api/accident-reports
 * Customer submits a new accident report.
 */
export const createAccidentReport = asyncHandler(
  async (req: Request, res: Response) => {
    const { title, date, time, location, isInsuranceAvailable, branchId } =
      req.body;

    if (!title || !date || !time || !location || !branchId) {
      throw new ErrorResponse(
        "title, date, time, location, and branchId are required",
        400
      );
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(time)) {
      throw new ErrorResponse("time must be in HH:MM format", 400);
    }

    const report = await AccidentReportModel.create({
      reportId: generateReportId(),
      customer: req.customer!._id,
      branch: branchId,
      title: title.trim(),
      date: new Date(date),
      time,
      location: location.trim(),
      isInsuranceAvailable: Boolean(isInsuranceAvailable),
    });

    res.status(201).json({ success: true, data: report });
  }
);

/**
 * GET /api/accident-reports/my-reports
 * Customer fetches their own reports.
 */
export const getMyAccidentReports = asyncHandler(
  async (req: Request, res: Response) => {
    const reports = await AccidentReportModel.find({
      customer: req.customer!._id,
    })
      .sort({ createdAt: -1 })
      .populate("branch", "branchName address");

    res
      .status(200)
      .json({ success: true, count: reports.length, data: reports });
  }
);

/**
 * GET /api/accident-reports/my-reports/:id
 * Customer fetches a single report (must own it).
 */
export const getMyAccidentReportById = asyncHandler(
  async (req: Request, res: Response) => {
    const report = await AccidentReportModel.findOne({
      _id: req.params.id,
      customer: req.customer!._id,
    }).populate("branch", "branchName address");

    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    res.status(200).json({ success: true, data: report });
  }
);

// ─── ADMIN ────────────────────────────────────────────────────────────────────

/**
 * GET /api/accident-reports
 * Admin fetches all reports with optional filters + pagination.
 */
export const getAllAccidentReports = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      status,
      branchId,
      isInsuranceAvailable,
      page = "1",
      limit = "20",
    } = req.query;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (branchId) filter.branch = branchId;
    if (isInsuranceAvailable !== undefined) {
      filter.isInsuranceAvailable = isInsuranceAvailable === "true";
    }

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [reports, total] = await Promise.all([
      AccidentReportModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("customer", "phoneNumber")
        .populate("branch", "branchName address"),
      AccidentReportModel.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: reports.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: reports,
    });
  }
);

/**
 * GET /api/accident-reports/:id
 * Admin fetches a single report by ID.
 */
export const getAccidentReportById = asyncHandler(
  async (req: Request, res: Response) => {
    const report = await AccidentReportModel.findById(req.params.id)
      .populate("customer", "phoneNumber")
      .populate("branch", "branchName address");

    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    res.status(200).json({ success: true, data: report });
  }
);

/**
 * PATCH /api/accident-reports/:id/status
 * Admin updates report status or adds notes.
 */
export const updateReportStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { status, adminNotes } = req.body;
    const allowedStatuses = ["pending", "reviewed", "closed"];

    if (status && !allowedStatuses.includes(status)) {
      throw new ErrorResponse(
        `status must be one of: ${allowedStatuses.join(", ")}`,
        400
      );
    }

    const update: Record<string, unknown> = {};
    if (status) update.status = status;
    if (adminNotes !== undefined) update.adminNotes = adminNotes.trim();

    const report = await AccidentReportModel.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    res.status(200).json({ success: true, data: report });
  }
);

/**
 * GET /api/accident-reports/download
 * Admin downloads all reports as CSV.
 * Query params: same filters as getAllAccidentReports (no pagination).
 */
export const downloadAccidentReportsCSV = asyncHandler(
  async (req: Request, res: Response) => {
    const { status, branchId, isInsuranceAvailable } = req.query;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (branchId) filter.branch = branchId;
    if (isInsuranceAvailable !== undefined) {
      filter.isInsuranceAvailable = isInsuranceAvailable === "true";
    }

    const reports = await AccidentReportModel.find(filter)
      .sort({ createdAt: -1 })
      .populate<{ customer: { phoneNumber: string } }>(
        "customer",
        "phoneNumber"
      )
      .populate<{ branch: { branchName: string } }>("branch", "branchName")
      .lean();

    const csvHeaders = [
      "Report ID",
      "Title",
      "Date",
      "Time",
      "Location",
      "Insurance Available",
      "Status",
      "Customer Phone",
      "Branch",
      "Admin Notes",
      "Submitted At",
    ].join(",");

    const escape = (val: unknown): string => {
      const str = val == null ? "" : String(val);
      // Wrap in quotes if contains comma, quote, or newline
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const csvRows = reports.map((r) =>
      [
        r.reportId,
        r.title,
        new Date(r.date).toISOString().split("T")[0],
        r.time,
        r.location,
        r.isInsuranceAvailable ? "Yes" : "No",
        r.status,
        (r.customer as any)?.phoneNumber ?? "",
        (r.branch as any)?.branchName ?? "",
        r.adminNotes ?? "",
        new Date(r.createdAt).toISOString(),
      ]
        .map(escape)
        .join(",")
    );

    const csv = [csvHeaders, ...csvRows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="accident_reports_${Date.now()}.csv"`
    );
    res.status(200).send(csv);
  }
);
