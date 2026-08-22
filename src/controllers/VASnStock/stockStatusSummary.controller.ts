import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { resolveBranchScope } from "../../service/rag/scope";
import { StockConceptModel } from "../../models/BikeSystemModel2/StockConcept";
import { StockConceptCSVModel } from "../../models/BikeSystemModel3/StockConceptCSV";

interface StatusBreakdown {
  total: number;
  sold: number;
  notSold: number;
  byStatus: Record<string, number>;
}

/**
 * "Not sold" is every status that is not "Sold" — Available, Reserved,
 * Service, and (manual stock only) Damaged and Transit. `byStatus` is
 * returned alongside so a caller can show the split rather than trusting
 * this two-way bucketing.
 */
function summarize(rows: { _id: string | null; count: number }[]): StatusBreakdown {
  const byStatus: Record<string, number> = {};
  let total = 0;
  let sold = 0;

  for (const row of rows) {
    const status = row._id ?? "Unknown";
    byStatus[status] = (byStatus[status] ?? 0) + row.count;
    total += row.count;
    if (status === "Sold") sold += row.count;
  }

  return { total, sold, notSold: total - sold, byStatus };
}

/**
 * @desc    Sold / not-sold vehicle counts for both stock collections,
 *          broken down by stockStatus.status.
 * @route   GET /api/stock-concept/status-summary?branchId=
 * @access  Super-Admin (all branches, or ?branchId=), Branch-Admin (own branch)
 */
export const getStockStatusSummary = asyncHandler(
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

    const manualMatch: Record<string, any> = { isActive: { $ne: false } };
    // Mirrors getCSVStockAssignStats rather than getCSVStocks: $ne excludes
    // only auto-registration placeholders while still counting legacy rows
    // written before `creationSource` existed, which an exact
    // creationSource: "csv_import" match would silently drop.
    const csvMatch: Record<string, any> = {
      isActive: { $ne: false },
      creationSource: { $ne: "automatic_creation" },
    };

    if (scope !== "all") {
      manualMatch["stockStatus.branchId"] = scope;
      csvMatch["stockStatus.branchId"] = scope;
    }

    const groupByStatus = [
      { $group: { _id: "$stockStatus.status", count: { $sum: 1 } } },
    ];

    const [manualRows, csvRows] = await Promise.all([
      StockConceptModel.aggregate([{ $match: manualMatch }, ...groupByStatus]),
      StockConceptCSVModel.aggregate([{ $match: csvMatch }, ...groupByStatus]),
    ]);

    const manual = summarize(manualRows);
    const csv = summarize(csvRows);

    res.status(200).json({
      success: true,
      data: {
        manual,
        csv,
        combined: {
          total: manual.total + csv.total,
          sold: manual.sold + csv.sold,
          notSold: manual.notSold + csv.notSold,
        },
      },
    });
  },
);
