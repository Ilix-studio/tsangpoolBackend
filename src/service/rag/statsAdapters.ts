import { JobCardModel } from "../../models/ServiceM/JobCard";
import AccidentReportModel from "../../models/AdminFeatures/AccidentReport";
import { StockConceptModel } from "../../models/BikeSystemModel2/StockConcept";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";
import { BranchScope } from "./scope";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Job-card stats for the RAG structured-query path. No existing HTTP stats
 * controller exists for job cards (unlike parts), so this is new logic —
 * modeled 1:1 on partsStats.controller.ts's computePartsStats() pattern
 * (branch-scoped match, monthly aggregate, totals) rather than a new pattern.
 */
export async function computeJobCardStats(branch: BranchScope, year: number) {
  const baseMatch: Record<string, any> = {};
  if (branch !== "all") baseMatch.branch = branch;

  const yearMatch = {
    ...baseMatch,
    createdAt: {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  };

  const [monthly, totals, byStatus] = await Promise.all([
    JobCardModel.aggregate([
      { $match: yearMatch },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          jobCardCount: { $sum: 1 },
          grandTotal: { $sum: "$grandTotal" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]),
    JobCardModel.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalJobCards: { $sum: 1 },
          totalGrandTotal: { $sum: "$grandTotal" },
        },
      },
    ]),
    JobCardModel.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const monthlyFilled = MONTHS.map((label, i) => {
    const found = monthly.find((m) => m._id.month === i + 1);
    return {
      month: label,
      jobCardCount: found?.jobCardCount ?? 0,
      grandTotal: found?.grandTotal ?? 0,
    };
  });

  const t = totals[0] ?? { totalJobCards: 0, totalGrandTotal: 0 };

  return {
    year,
    monthly: monthlyFilled,
    totals: {
      totalJobCards: t.totalJobCards,
      totalGrandTotal: t.totalGrandTotal,
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    },
  };
}

/**
 * Accident-report stats for the RAG structured-query path — simple
 * count-by-status, scoped identically to the other sources.
 */
export async function computeAccidentReportStats(branch: BranchScope) {
  const baseMatch: Record<string, any> = {};
  if (branch !== "all") baseMatch.branch = branch;

  const [total, byStatus] = await Promise.all([
    AccidentReportModel.countDocuments(baseMatch),
    AccidentReportModel.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  return {
    totals: {
      total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    },
  };
}

/**
 * Stock-assignment stats (bikes/scooties sold to customers) for the RAG
 * structured-query path — modeled on computeJobCardStats. Branch lives on
 * `stockStatus.branchId`, which is populated regardless of sale status, so
 * scoping this is a direct match unlike VAS assignment below.
 */
export async function computeStockAssignStats(branch: BranchScope, year: number) {
  const baseMatch: Record<string, any> = { "salesInfo.soldDate": { $exists: true } };
  if (branch !== "all") baseMatch["stockStatus.branchId"] = branch;

  const yearMatch = {
    ...baseMatch,
    "salesInfo.soldDate": {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  };

  const [monthly, totals, byPaymentStatus] = await Promise.all([
    StockConceptModel.aggregate([
      { $match: yearMatch },
      {
        $group: {
          _id: { month: { $month: "$salesInfo.soldDate" } },
          assignedCount: { $sum: 1 },
          revenue: { $sum: "$salesInfo.salePrice" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]),
    StockConceptModel.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalAssigned: { $sum: 1 },
          totalRevenue: { $sum: "$salesInfo.salePrice" },
        },
      },
    ]),
    StockConceptModel.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$salesInfo.paymentStatus", count: { $sum: 1 } } },
    ]),
  ]);

  const monthlyFilled = MONTHS.map((label, i) => {
    const found = monthly.find((m) => m._id.month === i + 1);
    return {
      month: label,
      assignedCount: found?.assignedCount ?? 0,
      revenue: found?.revenue ?? 0,
    };
  });

  const t = totals[0] ?? { totalAssigned: 0, totalRevenue: 0 };

  return {
    year,
    monthly: monthlyFilled,
    totals: {
      totalAssigned: t.totalAssigned,
      totalRevenue: t.totalRevenue,
      byPaymentStatus: Object.fromEntries(
        byPaymentStatus.map((s) => [s._id ?? "Unknown", s.count]),
      ),
    },
  };
}

/**
 * VAS-activation stats for the RAG structured-query path. CustomerVehicle
 * has no branch field of its own — branch lives on the StockConcept it
 * references — so this needs a $lookup before it can be branch-scoped,
 * unlike the other structured sources.
 */
export async function computeVasAssignStats(branch: BranchScope, year: number) {
  const basePipeline: any[] = [
    { $unwind: "$activeValueAddedServices" },
    {
      $lookup: {
        from: StockConceptModel.collection.name,
        localField: "stockConcept",
        foreignField: "_id",
        as: "stock",
      },
    },
    { $unwind: "$stock" },
  ];
  if (branch !== "all") {
    basePipeline.push({ $match: { "stock.stockStatus.branchId": branch } });
  }

  const [monthly, totals] = await Promise.all([
    CustomerVehicleModel.aggregate([
      ...basePipeline,
      {
        $match: {
          "activeValueAddedServices.activatedDate": {
            $gte: new Date(`${year}-01-01`),
            $lt: new Date(`${year + 1}-01-01`),
          },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$activeValueAddedServices.activatedDate" } },
          activationCount: { $sum: 1 },
          revenue: { $sum: "$activeValueAddedServices.purchasePrice" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]),
    CustomerVehicleModel.aggregate([
      ...basePipeline,
      {
        $group: {
          _id: null,
          totalActivations: { $sum: 1 },
          totalRevenue: { $sum: "$activeValueAddedServices.purchasePrice" },
        },
      },
    ]),
  ]);

  const monthlyFilled = MONTHS.map((label, i) => {
    const found = monthly.find((m) => m._id.month === i + 1);
    return {
      month: label,
      activationCount: found?.activationCount ?? 0,
      revenue: found?.revenue ?? 0,
    };
  });

  const t = totals[0] ?? { totalActivations: 0, totalRevenue: 0 };

  return {
    year,
    monthly: monthlyFilled,
    totals: {
      totalActivations: t.totalActivations,
      totalRevenue: t.totalRevenue,
    },
  };
}
