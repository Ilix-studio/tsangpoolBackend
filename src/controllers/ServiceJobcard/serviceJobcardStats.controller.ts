import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { ServiceJobcardRecordModel } from "../../models/ServiceJobcard/ServiceJobcardRecord";
import { ServiceJobcardBatchModel } from "../../models/ServiceJobcard/ServiceJobcardBatch";
import { getUserBranch, isAdmin } from "../../types/user.types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Branch filter for list/stats:
 * - Super-Admin: all branches, or the one passed via `?branchId=`.
 * - Branch-scoped roles (Service-Admin): forced to their own branch.
 * Returns `null` when a branch is required but missing.
 */
export function branchFilter(req: Request): mongoose.Types.ObjectId | null | "all" {
  if (req.user && isAdmin(req.user)) {
    const q = req.query.branchId as string | undefined;
    if (!q) return "all";
    if (!mongoose.Types.ObjectId.isValid(q)) return null;
    return new mongoose.Types.ObjectId(q);
  }
  const branch = req.user ? getUserBranch(req.user) : null;
  if (!branch || !mongoose.Types.ObjectId.isValid(branch)) return null;
  return new mongoose.Types.ObjectId(branch);
}

/**
 * Core service-jobcard stats aggregation, factored out of the HTTP
 * controller so it can also be called directly by other structured-query
 * paths without duplicating the pipeline or going through Express.
 */
export async function computeServiceJobcardStats(
  branch: mongoose.Types.ObjectId | "all",
  year: number,
) {
  const baseMatch: Record<string, any> = { isActive: true };
  if (branch !== "all") baseMatch.branchId = branch;

  const yearMatch = {
    ...baseMatch,
    "normalized.jobCardClosedDate": {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  };

  // Totals reflect *current* state (isCurrent: true) — how many job cards
  // are on record right now, not how many upload-events ever happened.
  const totalsMatch = { ...baseMatch, isCurrent: true };
  const batchesMatch: Record<string, any> = { isActive: true };
  if (branch !== "all") batchesMatch.branchId = branch;

  const [monthly, totals, totalBatches] = await Promise.all([
    // Monthly trend counts every row ever created (added/changed events),
    // regardless of later correction — this is activity volume per month.
    ServiceJobcardRecordModel.aggregate([
      { $match: yearMatch },
      {
        $group: {
          _id: { month: { $month: "$normalized.jobCardClosedDate" } },
          jobCardCount: { $sum: 1 },
          reviewCount: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]),
    ServiceJobcardRecordModel.aggregate([
      { $match: totalsMatch },
      {
        $group: {
          _id: null,
          totalJobCards: { $sum: 1 },
          reviewJobCards: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
        },
      },
    ]),
    ServiceJobcardBatchModel.countDocuments(batchesMatch),
  ]);

  const monthlyFilled = MONTHS.map((label, i) => {
    const found = monthly.find((m) => m._id.month === i + 1);
    return {
      month: label,
      jobCardCount: found?.jobCardCount ?? 0,
      reviewCount: found?.reviewCount ?? 0,
    };
  });

  const t = totals[0] ?? { totalJobCards: 0, reviewJobCards: 0 };

  return {
    year,
    monthly: monthlyFilled,
    totals: {
      totalJobCards: t.totalJobCards,
      reviewJobCards: t.reviewJobCards,
      totalBatches,
    },
  };
}

/**
 * @desc    Service-jobcard KPIs + monthly upload distribution
 * @route   GET /api/service-jobcard/stats
 * @access  Service-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getServiceJobcardStats = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const data = await computeServiceJobcardStats(branch, year);

    res.status(200).json({ success: true, data });
  },
);

/**
 * @desc    Paginated list of imported service-jobcard rows
 * @route   GET /api/service-jobcard
 * @access  Service-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getAllServiceJobcards = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const query: Record<string, any> = { isActive: true };
    if (branch !== "all") query.branchId = branch;
    if (req.query.batchId) query.importBatch = req.query.batchId;
    if (req.query.needsReview === "true") query.needsReview = true;

    const [rows, total] = await Promise.all([
      ServiceJobcardRecordModel.find(query)
        .populate("branchId", "branchName")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      ServiceJobcardRecordModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  },
);

/**
 * @desc    Paginated list of imported service-jobcard rows for a specific day
 * @route   GET /api/service-jobcard/by-date?date=YYYY-MM-DD
 * @access  Service-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getServiceJobcardsByDate = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const dateParam = String(req.query.date ?? "").trim();
    if (!dateParam) {
      res.status(400);
      throw new Error("date query parameter is required");
    }

    const selectedDate = new Date(dateParam);
    if (Number.isNaN(selectedDate.getTime())) {
      res.status(400);
      throw new Error("Invalid date format");
    }

    const [year, month, day] = dateParam.split("-").map((part) => Number(part));
    if (!year || !month || !day) {
      res.status(400);
      throw new Error("date must be in YYYY-MM-DD format");
    }

    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const query: Record<string, any> = {
      isActive: true,
      "normalized.jobCardClosedDate": {
        $gte: startOfDay,
        $lt: endOfDay,
      },
    };
    if (branch !== "all") query.branchId = branch;
    if (req.query.batchId) query.importBatch = req.query.batchId;
    if (req.query.needsReview === "true") query.needsReview = true;

    const [rows, total] = await Promise.all([
      ServiceJobcardRecordModel.find(query)
        .populate("branchId", "branchName")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      ServiceJobcardRecordModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  },
);

/**
 * @desc    Recent upload batches
 * @route   GET /api/service-jobcard/batches
 * @access  Service-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getServiceJobcardBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const match: Record<string, any> = { isActive: true };
    if (branch !== "all") match.branchId = branch;

    const batches = await ServiceJobcardBatchModel.find(match)
      .populate("branchId", "branchName")
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ success: true, data: batches });
  },
);

/**
 * @desc    Import batches created on a specific day
 * @route   GET /api/service-jobcard/batches/by-date?date=YYYY-MM-DD
 * @access  Service-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getServiceJobcardBatchesByDate = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const dateParam = String(req.query.date ?? "").trim();
    if (!dateParam) {
      res.status(400);
      throw new Error("date query parameter is required");
    }

    const parsed = new Date(dateParam);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400);
      throw new Error("Invalid date format");
    }

    const [year, month, day] = dateParam.split("-").map((part) => Number(part));
    if (!year || !month || !day) {
      res.status(400);
      throw new Error("date must be in YYYY-MM-DD format");
    }

    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    const match: Record<string, any> = {
      isActive: true,
      createdAt: { $gte: startOfDay, $lt: endOfDay },
    };
    if (branch !== "all") match.branchId = branch;

    const batches = await ServiceJobcardBatchModel.find(match)
      .populate("branchId", "branchName")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: batches });
  },
);

/**
 * @desc    Current-state totals (job card count, revenue = sum
 *          totalJobCardRevenue, average revenue per card) plus the
 *          upload-by-date revenue trend and the most recent changelog.
 *          "Current" means isActive && isCurrent — a job card superseded by
 *          a later correction no longer double-counts.
 * @route   GET /api/service-jobcard/stock-status?branchId=
 * @access  Service-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getServiceJobcardStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const match: Record<string, any> = { isActive: true, isCurrent: true };
    if (branch !== "all") match.branchId = branch;

    const batchMatch: Record<string, any> = { isActive: true };
    if (branch !== "all") batchMatch.branchId = branch;

    const [[result], byDateDocs, latestDoc] = await Promise.all([
      ServiceJobcardRecordModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalItems: { $sum: 1 },
            totalRevenue: { $sum: { $ifNull: ["$normalized.totalJobCardRevenue", 0] } },
            avgRevenuePerCard: { $avg: "$normalized.totalJobCardRevenue" },
          },
        },
      ]),
      ServiceJobcardBatchModel.find(batchMatch)
        .select(
          "batchId fileName branchId createdAt revenueAfter revenueDelta addedRows changedRows",
        )
        .populate("branchId", "branchName")
        .sort({ createdAt: 1 })
        .lean(),
      ServiceJobcardBatchModel.findOne(batchMatch)
        .populate("branchId", "branchName")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const totalItems = result?.totalItems ?? 0;
    const totalRevenue = Math.round((result?.totalRevenue ?? 0) * 100) / 100;
    const avgRevenuePerCard =
      Math.round((result?.avgRevenuePerCard ?? 0) * 100) / 100;

    const byDate = byDateDocs.map((d: any) => ({
      batchId: d.batchId,
      date: d.createdAt,
      branchId: d.branchId?._id ?? d.branchId,
      branchName: d.branchId?.branchName,
      revenueAfter: d.revenueAfter ?? 0,
      revenueDelta: d.revenueDelta ?? 0,
      addedRows: d.addedRows ?? 0,
      changedRows: d.changedRows ?? 0,
    }));

    const latestChange = latestDoc
      ? {
          batchId: (latestDoc as any).batchId,
          fileName: (latestDoc as any).fileName,
          branchId: (latestDoc as any).branchId?._id ?? (latestDoc as any).branchId,
          branchName: (latestDoc as any).branchId?.branchName,
          createdAt: (latestDoc as any).createdAt,
          changesMarkdown: (latestDoc as any).changesMarkdown ?? "",
          addedRows: (latestDoc as any).addedRows ?? 0,
          changedRows: (latestDoc as any).changedRows ?? 0,
          revenueDelta: (latestDoc as any).revenueDelta ?? 0,
        }
      : null;

    res.status(200).json({
      success: true,
      data: {
        totalItems,
        totalRevenue,
        avgRevenuePerCard,
        byDate,
        latestChange,
      },
    });
  },
);
