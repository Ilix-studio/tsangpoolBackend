import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { SalesReportModel } from "../../models/SalesReport";
import { getUserBranch, isAdmin } from "../../types/user.types";

/**
 * Branch filter for list/batches:
 * - Super-Admin: all branches, or the one passed via `?branchId=`.
 * - Branch-Admin: forced to their own branch.
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
 * @desc    Paginated list of imported sales report rows
 * @route   GET /api/sales-report
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const getAllSalesReports = asyncHandler(
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
    if (req.query.matched !== undefined) {
      query.matched = req.query.matched === "true";
    }
    if (req.query.purchaseType) query.purchaseType = req.query.purchaseType;

    const [rows, total] = await Promise.all([
      SalesReportModel.find(query)
        .populate("branchId", "branchName")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      SalesReportModel.countDocuments(query),
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
 * @desc    Single sales report row
 * @route   GET /api/sales-report/:id
 * @access  Super-Admin (any), Branch-Admin (own branch)
 */
export const getSalesReportById = asyncHandler(
  async (req: Request, res: Response) => {
    const row = await SalesReportModel.findOne({
      _id: req.params.id,
      isActive: true,
    }).populate("branchId", "branchName");

    if (!row) {
      res.status(404);
      throw new Error("Sales report record not found");
    }

    if (req.user && !isAdmin(req.user)) {
      const ownBranch = getUserBranch(req.user);
      if (!ownBranch || ownBranch !== row.branchId.toString()) {
        res.status(403);
        throw new Error("Not authorized to view this branch's record");
      }
    }

    res.status(200).json({ success: true, data: row });
  },
);

/**
 * @desc    Recent upload batches, grouped, with totals + matched/unmatched
 *          breakdown per batch
 * @route   GET /api/sales-report/batches
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const getSalesReportBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const match: Record<string, any> = { isActive: true };
    if (branch !== "all") match.branchId = branch;

    const batches = await SalesReportModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$importBatch",
          fileName: { $first: "$fileName" },
          sourceFormat: { $first: "$sourceFormat" },
          importDate: { $first: "$importDate" },
          branchId: { $first: "$branchId" },
          uploadedBy: { $first: "$uploadedBy" },
          totalRecords: { $sum: 1 },
          totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
          matchedCount: {
            $sum: { $cond: [{ $eq: ["$matchOutcome", "matched_status_flipped"] }, 1, 0] },
          },
          unmatchedCount: {
            $sum: { $cond: [{ $eq: ["$matchOutcome", "unmatched"] }, 1, 0] },
          },
          reviewCount: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
        },
      },
      { $sort: { importDate: -1 } },
      { $limit: 50 },
    ]);

    res.status(200).json({
      success: true,
      data: batches.map((b) => ({
        batchId: b._id,
        fileName: b.fileName,
        sourceFormat: b.sourceFormat,
        importDate: b.importDate,
        branchId: b.branchId,
        totalRecords: b.totalRecords,
        totalPayment: b.totalPayment,
        matchedCount: b.matchedCount,
        unmatchedCount: b.unmatchedCount,
        reviewCount: b.reviewCount,
      })),
    });
  },
);

/**
 * @desc    Upload batches for a single calendar day (by importDate), with
 *          totals + matched/unmatched breakdown per batch
 * @route   GET /api/sales-report/batches/by-date?date=YYYY-MM-DD
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const getSalesReportBatchesByDate = asyncHandler(
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

    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    const match: Record<string, any> = {
      isActive: true,
      importDate: { $gte: startOfDay, $lt: endOfDay },
    };
    if (branch !== "all") match.branchId = branch;

    const batches = await SalesReportModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$importBatch",
          fileName: { $first: "$fileName" },
          sourceFormat: { $first: "$sourceFormat" },
          importDate: { $first: "$importDate" },
          branchId: { $first: "$branchId" },
          uploadedBy: { $first: "$uploadedBy" },
          totalRecords: { $sum: 1 },
          totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
          matchedCount: {
            $sum: { $cond: [{ $eq: ["$matchOutcome", "matched_status_flipped"] }, 1, 0] },
          },
          unmatchedCount: {
            $sum: { $cond: [{ $eq: ["$matchOutcome", "unmatched"] }, 1, 0] },
          },
          reviewCount: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
        },
      },
      { $sort: { importDate: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: batches.map((b) => ({
        batchId: b._id,
        fileName: b.fileName,
        sourceFormat: b.sourceFormat,
        importDate: b.importDate,
        branchId: b.branchId,
        totalRecords: b.totalRecords,
        totalPayment: b.totalPayment,
        matchedCount: b.matchedCount,
        unmatchedCount: b.unmatchedCount,
        reviewCount: b.reviewCount,
      })),
    });
  },
);

/**
 * @desc    Sales report KPIs — monthly trend, purchase-type breakdown,
 *          match-outcome breakdown, per-branch breakdown.
 * @route   GET /api/sales-report/kpis
 * @access  Super-Admin only
 */
export const getSalesReportKpis = asyncHandler(
  async (req: Request, res: Response) => {
    const year = Number(req.query.year) || new Date().getFullYear();

    // Scope through branchFilter like every sibling endpoint in this file.
    // This previously trusted `?branchId=` verbatim and defaulted to ALL
    // branches when it was absent, which is why the route was Super-Admin
    // only; a branch-scoped role reaching it would have seen every branch's
    // sales, and could have read any other branch by passing its id.
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const baseMatch: Record<string, any> = { isActive: true };
    if (branch !== "all") baseMatch.branchId = branch;

    const yearMatch = {
      ...baseMatch,
      importDate: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    };

    const [monthly, byPurchaseType, byOutcome, perBranch, totals] =
      await Promise.all([
        SalesReportModel.aggregate([
          { $match: yearMatch },
          {
            $group: {
              _id: { month: { $month: "$importDate" } },
              count: { $sum: 1 },
              totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
            },
          },
          { $sort: { "_id.month": 1 } },
        ]),
        SalesReportModel.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: "$purchaseType",
              count: { $sum: 1 },
              totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
            },
          },
        ]),
        SalesReportModel.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: "$matchOutcome",
              count: { $sum: 1 },
            },
          },
        ]),
        SalesReportModel.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: "$branchId",
              count: { $sum: 1 },
              totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
            },
          },
        ]),
        SalesReportModel.aggregate([
          { $match: baseMatch },
          {
            $group: {
              _id: null,
              totalRecords: { $sum: 1 },
              totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
            },
          },
        ]),
      ]);

    const monthlyFilled = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ].map((month, i) => {
      const found = monthly.find((m) => m._id.month === i + 1);
      return {
        month,
        count: found?.count ?? 0,
        totalPayment: found?.totalPayment ?? 0,
      };
    });

    const t = totals[0] ?? { totalRecords: 0, totalPayment: 0 };

    res.status(200).json({
      success: true,
      data: {
        year,
        totals: {
          totalRecords: t.totalRecords,
          totalPayment: t.totalPayment,
        },
        monthly: monthlyFilled,
        byPurchaseType: byPurchaseType.map((p) => ({
          purchaseType: p._id || "Unknown",
          count: p.count,
          totalPayment: p.totalPayment,
        })),
        byOutcome: byOutcome.map((o) => ({
          outcome: o._id,
          count: o.count,
        })),
        perBranch: perBranch.map((b) => ({
          branchId: b._id,
          count: b.count,
          totalPayment: b.totalPayment,
        })),
      },
    });
  },
);
