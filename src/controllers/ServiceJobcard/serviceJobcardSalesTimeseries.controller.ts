import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { ServiceJobcardRecordModel } from "../../models/ServiceJobcard/ServiceJobcardRecord";
import BranchModel from "../../models/Branch";
import { branchFilter } from "./serviceJobcardStats.controller";

export type Granularity = "day" | "week" | "month" | "year";
const GRANULARITIES: Granularity[] = ["day", "week", "month", "year"];

function bucketIdExpr(granularity: Granularity) {
  const dateField = "$normalized.jobCardClosedDate";
  switch (granularity) {
    case "day":
      return {
        y: { $year: dateField },
        m: { $month: dateField },
        d: { $dayOfMonth: dateField },
      };
    case "week":
      return {
        y: { $isoWeekYear: dateField },
        w: { $isoWeek: dateField },
      };
    case "month":
      return {
        y: { $year: dateField },
        m: { $month: dateField },
      };
    case "year":
    default:
      return { y: { $year: dateField } };
  }
}

function formatBucketLabel(
  granularity: Granularity,
  id: { y: number; m?: number; d?: number; w?: number },
  bucketStart: Date,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (granularity) {
    case "day":
      return bucketStart.toISOString().slice(0, 10);
    case "week":
      return `${id.y}-W${pad(id.w ?? 0)}`;
    case "month":
      return `${id.y}-${pad(id.m ?? 0)}`;
    case "year":
    default:
      return `${id.y}`;
  }
}

/**
 * Core sales-timeseries aggregation, factored out of the HTTP controller so
 * it can also be called directly by the RAG structured-query path
 * (rag.service.ts) without duplicating the pipeline or going through Express.
 * Queries ServiceJobcardRecordModel directly (moved off the generic
 * DataImport module's ImportedRow — service-jobcard is the sales fact table,
 * grain = one closed job card, now dedicated).
 */
export async function computeSalesTimeseries(
  branch: mongoose.Types.ObjectId | "all",
  opts: { granularity: Granularity; from?: string; to?: string },
) {
  const { granularity, from, to } = opts;

  const match: Record<string, any> = {
    isActive: true,
    "normalized.jobCardClosedDate": { $ne: null, $exists: true },
  };
  if (branch !== "all") match.branchId = branch;
  if (from) match["normalized.jobCardClosedDate"].$gte = new Date(from);
  if (to) match["normalized.jobCardClosedDate"].$lte = new Date(to);

  const [timeseriesRaw, byModelRaw, byBranchRaw, byTechnicianRaw] =
      await Promise.all([
        ServiceJobcardRecordModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: bucketIdExpr(granularity),
              bucketStart: { $min: "$normalized.jobCardClosedDate" },
              totalRevenue: { $sum: "$normalized.totalJobCardRevenue" },
              labourRevenue: { $sum: "$normalized.labourRevenue" },
              partsRevenue: { $sum: "$normalized.partsRevenue" },
              lubesRevenue: { $sum: "$normalized.lubesRevenue" },
              accessoriesRevenue: { $sum: "$normalized.accessoriesRevenue" },
              jobCardCount: { $sum: 1 },
            },
          },
          { $sort: { "_id.y": 1, "_id.m": 1, "_id.w": 1, "_id.d": 1 } },
        ]),
        ServiceJobcardRecordModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: "$normalized.modelName",
              totalRevenue: { $sum: "$normalized.totalJobCardRevenue" },
              jobCardCount: { $sum: 1 },
            },
          },
          { $sort: { totalRevenue: -1 } },
          { $limit: 20 },
        ]),
        ServiceJobcardRecordModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: "$branchId",
              totalRevenue: { $sum: "$normalized.totalJobCardRevenue" },
              jobCardCount: { $sum: 1 },
            },
          },
          { $sort: { totalRevenue: -1 } },
        ]),
        ServiceJobcardRecordModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: "$normalized.technicianName",
              totalRevenue: { $sum: "$normalized.totalJobCardRevenue" },
              jobCardCount: { $sum: 1 },
            },
          },
          { $sort: { totalRevenue: -1 } },
          { $limit: 20 },
        ]),
      ]);

  const timeseries = timeseriesRaw.map((r) => ({
    bucket: formatBucketLabel(granularity, r._id, r.bucketStart),
    bucketStart: r.bucketStart,
    totalRevenue: r.totalRevenue ?? 0,
    labourRevenue: r.labourRevenue ?? 0,
    partsRevenue: r.partsRevenue ?? 0,
    lubesRevenue: r.lubesRevenue ?? 0,
    accessoriesRevenue: r.accessoriesRevenue ?? 0,
    jobCardCount: r.jobCardCount ?? 0,
  }));

  const byModel = byModelRaw.map((r) => ({
    modelName: r._id ?? "Unknown",
    totalRevenue: r.totalRevenue ?? 0,
    jobCardCount: r.jobCardCount ?? 0,
  }));

  const byTechnician = byTechnicianRaw.map((r) => ({
    technicianName: r._id ?? "Unknown",
    totalRevenue: r.totalRevenue ?? 0,
    jobCardCount: r.jobCardCount ?? 0,
  }));

  const branchIds = byBranchRaw.map((r) => r._id).filter(Boolean);
  const branches = await BranchModel.find({ _id: { $in: branchIds } }).select(
    "branchName",
  );
  const branchNameById = new Map(
    branches.map((b) => [String(b._id), b.branchName]),
  );
  const byBranch = byBranchRaw.map((r) => ({
    branchId: r._id,
    branchName: r._id ? branchNameById.get(r._id.toString()) ?? "Unknown" : "Unknown",
    totalRevenue: r.totalRevenue ?? 0,
    jobCardCount: r.jobCardCount ?? 0,
  }));

  return {
    granularity,
    from: from ?? null,
    to: to ?? null,
    timeseries,
    byModel,
    byBranch,
    byTechnician,
  };
}

/**
 * @desc    Job-card revenue timeseries bucketed by day/week/month/year, plus
 *          model / branch / technician breakdowns.
 * @route   GET /api/service-jobcard/sales/timeseries?granularity=&from=&to=&branchId=
 * @access  Any authenticated role (scoped to their branch)
 */
export const getSalesTimeseries = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const granularityParam = (req.query.granularity as string) || "day";
    if (!GRANULARITIES.includes(granularityParam as Granularity)) {
      res.status(400);
      throw new Error("granularity must be one of day, week, month, year");
    }

    const data = await computeSalesTimeseries(branch, {
      granularity: granularityParam as Granularity,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });

    res.status(200).json({ success: true, data });
  },
);
