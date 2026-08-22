import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { resolveBranchScope } from "../../../service/rag/scope";
import {
  computeStockAssignStats,
  computeVasAssignStats,
} from "../../../service/rag/statsAdapters";
import { CustomerVehicleModel } from "../../../models/BikeSystemModel2/CustomerVehicleModel";
import { StockConceptModel } from "../../../models/BikeSystemModel2/StockConcept";
import { StockConceptCSVModel } from "../../../models/BikeSystemModel3/StockConceptCSV";

/**
 * @desc    Stock-assignment KPIs + monthly breakdown
 * @route   GET /api/stock-concept/assign-stats
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const getStockAssignStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const scope = resolveBranchScope(req.user, req.query.branchId as string);
    if (scope === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const data = await computeStockAssignStats(scope, year);

    res.status(200).json({ success: true, data });
  },
);

/**
 * @desc    VAS-activation KPIs + monthly breakdown
 * @route   GET /api/value-added-services/assign-stats
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const getVasAssignStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const scope = resolveBranchScope(req.user, req.query.branchId as string);
    if (scope === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const data = await computeVasAssignStats(scope, year);

    res.status(200).json({ success: true, data });
  },
);

/**
 * @desc    Combined VAS activations + revenue across StockConcept and
 *          StockConceptCSV vehicles
 * @route   GET /api/value-added-services/vas-assign-stats
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const getCombinedVasAssignStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const scope = resolveBranchScope(req.user, req.query.branchId as string);
    if (scope === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const year = Number(req.query.year) || new Date().getFullYear();

    const basePipeline: any[] = [
      {
        $match: {
          stockType: { $in: ["StockConcept", "StockConceptCSV"] },
          isActive: true,
        },
      },
      {
        $lookup: {
          from: StockConceptModel.collection.name,
          localField: "stockConcept",
          foreignField: "_id",
          as: "stockConceptDoc",
        },
      },
      {
        $lookup: {
          from: StockConceptCSVModel.collection.name,
          localField: "stockConcept",
          foreignField: "_id",
          as: "stockCsvDoc",
        },
      },
      {
        $addFields: {
          stockDoc: {
            $ifNull: [{ $arrayElemAt: ["$stockConceptDoc", 0] }, { $arrayElemAt: ["$stockCsvDoc", 0] }],
          },
        },
      },
      { $match: { stockDoc: { $ne: null } } },
    ];

    if (scope !== "all") {
      basePipeline.push({
        $match: { "stockDoc.stockStatus.branchId": scope },
      });
    }

    const [monthly, totals] = await Promise.all([
      CustomerVehicleModel.aggregate([
        ...basePipeline,
        { $unwind: "$activeValueAddedServices" },
        {
          $match: {
            "activeValueAddedServices.isActive": true,
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
        { $unwind: "$activeValueAddedServices" },
        {
          $match: {
            "activeValueAddedServices.isActive": true,
          },
        },
        {
          $group: {
            _id: null,
            totalActivations: { $sum: 1 },
            totalRevenue: { $sum: "$activeValueAddedServices.purchasePrice" },
          },
        },
      ]),
    ]);

    const MONTHS = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const monthlyFilled = MONTHS.map((month, i) => {
      const found = monthly.find((m) => m._id.month === i + 1);
      return {
        month,
        activationCount: found?.activationCount ?? 0,
        revenue: found?.revenue ?? 0,
      };
    });

    const t = totals[0] ?? { totalActivations: 0, totalRevenue: 0 };

    res.status(200).json({
      success: true,
      data: {
        year,
        totals: {
          totalActivations: t.totalActivations,
          totalRevenue: t.totalRevenue,
        },
        monthly: monthlyFilled,
      },
    });
  },
);
