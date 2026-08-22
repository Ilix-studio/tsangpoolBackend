import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { CounterSaleReportModel } from "../../models/CounterSaleReport";
import { getUserBranch, isAdmin } from "../../types/user.types";

/**
 * Branch filter for list/batches:
 * - Super-Admin: all branches, or the one passed via `?branchId=`.
 * - Branch-scoped roles (Branch-Admin, Part-Admin): forced to their own branch.
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
 * @desc    Paginated list of imported counter sale rows
 * @route   GET /api/counter-sale
 * @access  Super-Admin (all or ?branchId=), Branch-Admin / Part-Admin (own branch)
 */
export const getAllCounterSales = asyncHandler(
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

    const [rows, total] = await Promise.all([
      CounterSaleReportModel.find(query)
        .populate("branchId", "branchName")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      CounterSaleReportModel.countDocuments(query),
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
 * @desc    Single counter sale row
 * @route   GET /api/counter-sale/:id
 * @access  Super-Admin (any), Branch-Admin / Part-Admin (own branch)
 */
export const getCounterSaleById = asyncHandler(
  async (req: Request, res: Response) => {
    const row = await CounterSaleReportModel.findOne({
      _id: req.params.id,
      isActive: true,
    }).populate("branchId", "branchName");

    if (!row) {
      res.status(404);
      throw new Error("Counter sale record not found");
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
 * @desc    Recent upload batches, grouped, with the Total Invoice sum per batch
 * @route   GET /api/counter-sale/batches
 * @access  Super-Admin (all or ?branchId=), Branch-Admin / Part-Admin (own branch)
 */
export const getCounterSaleBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const match: Record<string, any> = { isActive: true };
    if (branch !== "all") match.branchId = branch;

    const batches = await CounterSaleReportModel.aggregate([
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
          totalInvoice: { $sum: { $ifNull: ["$totalInvoice", 0] } },
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
        totalInvoice: b.totalInvoice,
        reviewCount: b.reviewCount,
      })),
    });
  },
);

/**
 * @desc    Upload batches for a single calendar day (by importDate), with the
 *          Total Invoice sum per batch
 * @route   GET /api/counter-sale/batches/by-date?date=YYYY-MM-DD
 * @access  Super-Admin (all or ?branchId=), Branch-Admin / Part-Admin (own branch)
 */
export const getCounterSaleBatchesByDate = asyncHandler(
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

    const batches = await CounterSaleReportModel.aggregate([
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
          totalInvoice: { $sum: { $ifNull: ["$totalInvoice", 0] } },
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
        totalInvoice: b.totalInvoice,
        reviewCount: b.reviewCount,
      })),
    });
  },
);
