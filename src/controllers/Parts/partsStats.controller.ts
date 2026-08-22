import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { PartsReportModel } from "../../models/PartsReport";
import { PartsReportBatchModel } from "../../models/PartsReportBatch";
import { getUserBranch, isAdmin } from "../../types/user.types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Branch filter for list/stats:
 * - Super-Admin: all branches, or the one passed via `?branchId=`.
 * - Branch-scoped roles (Part-Admin): forced to their own branch.
 * Returns `null` when a branch is required but missing.
 */
function branchFilter(req: Request): mongoose.Types.ObjectId | null | "all" {
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
 * Core parts-stats aggregation, factored out of the HTTP controller so it can
 * also be called directly by the RAG structured-query path (rag.service.ts)
 * without duplicating the pipeline or going through Express.
 */
export async function computePartsStats(
  branch: mongoose.Types.ObjectId | "all",
  year: number,
) {
  const baseMatch: Record<string, any> = { isActive: true };
  if (branch !== "all") baseMatch.branchId = branch;

  const yearMatch = {
    ...baseMatch,
    importDate: {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  };

  // Totals reflect *current* state (isCurrent: true) — how many parts are in
  // stock right now, not how many upload-events ever happened historically.
  const totalsMatch = { ...baseMatch, isCurrent: true };
  const batchesMatch: Record<string, any> = { isActive: true };
  if (branch !== "all") batchesMatch.branchId = branch;

  const [monthly, totals, totalBatches] = await Promise.all([
    // Monthly trend counts every row ever created (added/changed events),
    // regardless of later supersession — this is activity volume per month.
    PartsReportModel.aggregate([
      { $match: yearMatch },
      {
        $group: {
          _id: { month: { $month: "$importDate" } },
          partCount: { $sum: 1 },
          reviewCount: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]),
    PartsReportModel.aggregate([
      { $match: totalsMatch },
      {
        $group: {
          _id: null,
          totalParts: { $sum: 1 },
          reviewParts: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
        },
      },
    ]),
    PartsReportBatchModel.countDocuments(batchesMatch),
  ]);

  const monthlyFilled = MONTHS.map((label, i) => {
    const found = monthly.find((m) => m._id.month === i + 1);
    return {
      month: label,
      partCount: found?.partCount ?? 0,
      reviewCount: found?.reviewCount ?? 0,
    };
  });

  const t = totals[0] ?? { totalParts: 0, reviewParts: 0 };

  return {
    year,
    monthly: monthlyFilled,
    totals: {
      totalParts: t.totalParts,
      reviewParts: t.reviewParts,
      totalBatches,
    },
  };
}

/**
 * @desc    Parts KPIs + monthly upload distribution
 * @route   GET /api/parts/stats
 * @access  Part-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getPartsStats = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const data = await computePartsStats(branch, year);

    res.status(200).json({ success: true, data });
  },
);

/**
 * @desc    Paginated list of imported parts rows
 * @route   GET /api/parts
 * @access  Part-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getAllParts = asyncHandler(
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

    const [parts, total] = await Promise.all([
      PartsReportModel.find(query)
        .populate("branchId", "branchName")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      PartsReportModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: parts,
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
 * @route   GET /api/parts/batches
 * @access  Part-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getPartsBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const match: Record<string, any> = { isActive: true };
    if (branch !== "all") match.branchId = branch;

    const batches = await PartsReportBatchModel.find(match)
      .populate("branchId", "branchName")
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ success: true, data: batches });
  },
);

/**
 * @desc    Parts upload batches created on one calendar day, same shape and
 *          branch scoping as getPartsBatches. Peer of the sales-report
 *          by-date endpoint the folder dashboards share a UI pattern with.
 * @route   GET /api/parts/batches/by-date?date=YYYY-MM-DD&branchId=
 * @access  Part-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getPartsBatchesByDate = asyncHandler(
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

    const [year, month, day] = dateParam.split("-").map((part) => Number(part));
    if (!year || !month || !day) {
      res.status(400);
      throw new Error("date must be in YYYY-MM-DD format");
    }

    // Half-open [start, next day) so every instant of the chosen day is
    // included without depending on millisecond precision.
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    const match: Record<string, any> = {
      isActive: true,
      createdAt: { $gte: startOfDay, $lt: endOfDay },
    };
    if (branch !== "all") match.branchId = branch;

    const batches = await PartsReportBatchModel.find(match)
      .populate("branchId", "branchName")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: batches });
  },
);

/**
 * @desc    Current-state totals (item count, revenue = sum(quantity *
 *          unitPrice), average unit price) plus the upload-by-date revenue
 *          trend and the most recent changelog, across parts-stock uploads.
 *          "Current" means isActive && isCurrent — a row superseded by a
 *          later upload (changed value or dropped part) no longer counts.
 * @route   GET /api/parts/stock-status?branchId=
 * @access  Part-Admin (own branch), Super-Admin (all or ?branchId=)
 */
export const getPartsStockStatus = asyncHandler(
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
      PartsReportModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalItems: { $sum: 1 },
            totalRevenue: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$normalized.quantity", 0] },
                  { $ifNull: ["$normalized.unitPrice", 0] },
                ],
              },
            },
            // $avg ignores missing/non-numeric unitPrice values rather than
            // treating them as 0, so this is the mean over parts that
            // actually have a recorded Unit Price.
            avgUnitPrice: { $avg: "$normalized.unitPrice" },
          },
        },
      ]),
      PartsReportBatchModel.find(batchMatch)
        .select(
          "batchId fileName branchId createdAt revenueAfter revenueDelta addedRows changedRows removedRows",
        )
        .populate("branchId", "branchName")
        .sort({ createdAt: 1 })
        .lean(),
      PartsReportBatchModel.findOne(batchMatch)
        .populate("branchId", "branchName")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const totalItems = result?.totalItems ?? 0;
    const totalRevenue = Math.round((result?.totalRevenue ?? 0) * 100) / 100;
    const avgUnitPrice = Math.round((result?.avgUnitPrice ?? 0) * 100) / 100;

    const byDate = byDateDocs.map((d: any) => ({
      batchId: d.batchId,
      date: d.createdAt,
      branchId: d.branchId?._id ?? d.branchId,
      branchName: d.branchId?.branchName,
      revenueAfter: d.revenueAfter ?? 0,
      revenueDelta: d.revenueDelta ?? 0,
      addedRows: d.addedRows ?? 0,
      changedRows: d.changedRows ?? 0,
      removedRows: d.removedRows ?? 0,
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
          removedRows: (latestDoc as any).removedRows ?? 0,
          revenueDelta: (latestDoc as any).revenueDelta ?? 0,
        }
      : null;

    res.status(200).json({
      success: true,
      data: {
        totalItems,
        totalRevenue,
        avgUnitPrice,
        byDate,
        latestChange,
      },
    });
  },
);
