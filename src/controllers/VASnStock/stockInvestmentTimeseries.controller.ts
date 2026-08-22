import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { resolveBranchScope } from "../../service/rag/scope";
import {
  computeStockInvestmentTimeseries,
  INVESTMENT_GRANULARITIES,
  InvestmentGranularity,
} from "../../service/stockInvestmentTimeseries.service";

/**
 * @desc    Day-bucketed (default) sum of CSV stock costPrice — how much was
 *          invested in incoming vehicle stock per day/week/month/year.
 *          Defaults to the trailing 30 days when no ?from= is given.
 * @route   GET /api/csv-stock/investment/timeseries?granularity=&from=&to=&branchId=
 * @access  Super-Admin (all branches, or ?branchId=)
 */
export const getStockInvestmentTimeseries = asyncHandler(
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

    const granularityParam = (req.query.granularity as string) || "day";
    if (!INVESTMENT_GRANULARITIES.includes(granularityParam as InvestmentGranularity)) {
      res.status(400);
      throw new Error("granularity must be one of day, week, month, year");
    }

    const data = await computeStockInvestmentTimeseries(scope, {
      granularity: granularityParam as InvestmentGranularity,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });

    res.status(200).json({ success: true, data });
  },
);
