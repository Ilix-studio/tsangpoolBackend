import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { resolveBranchScope } from "../../service/rag/scope";
import { computeStockBatchReports } from "../../service/stockBatchReport.service";

/**
 * @desc    Per-upload-batch investment/revenue report for CSV stock —
 *          total vehicles, cost-price invested, assigned/left, and revenue
 *          from vehicle sales + VAS + parts on those vehicles.
 * @route   GET /api/csv-stock/batch-reports
 * @access  Super-Admin (all branches, or ?branchId=)
 */
export const getStockBatchReports = asyncHandler(
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

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const result = await computeStockBatchReports(scope, { page, limit });

    res.status(200).json({ success: true, ...result });
  },
);
