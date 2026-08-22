import { StockConceptCSVModel } from "../models/BikeSystemModel3/StockConceptCSV";
import { BranchScope } from "./rag/scope";

export type InvestmentGranularity = "day" | "week" | "month" | "year";
const GRANULARITIES: InvestmentGranularity[] = ["day", "week", "month", "year"];
export { GRANULARITIES as INVESTMENT_GRANULARITIES };

function bucketIdExpr(granularity: InvestmentGranularity) {
  const dateField = "$csvImportDate";
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
  granularity: InvestmentGranularity,
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

export interface StockInvestmentPoint {
  bucket: string;
  bucketStart: Date;
  totalCostPrice: number;
  vehicleCount: number;
}

/**
 * Day-bucketed (by default) sum of StockConceptCSV.costPrice — how much was
 * invested in incoming CSV stock per day. Defaults to the trailing 30 days
 * when no `from` is given, since bucketing the entire import history by day
 * would return an unbounded number of points.
 */
export async function computeStockInvestmentTimeseries(
  scope: BranchScope,
  opts: { granularity: InvestmentGranularity; from?: string; to?: string },
): Promise<{
  granularity: InvestmentGranularity;
  from: string;
  to: string | null;
  timeseries: StockInvestmentPoint[];
  totals: { totalCostPrice: number; vehicleCount: number };
}> {
  const { granularity, to } = opts;
  const from =
    opts.from ??
    new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();

  const match: Record<string, any> = {
    csvImportDate: { $gte: new Date(from) },
  };
  if (to) match.csvImportDate.$lte = new Date(to);
  if (scope !== "all") match["stockStatus.branchId"] = scope;

  const raw = await StockConceptCSVModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: bucketIdExpr(granularity),
        bucketStart: { $min: "$csvImportDate" },
        totalCostPrice: { $sum: { $ifNull: ["$costPrice", 0] } },
        vehicleCount: { $sum: 1 },
      },
    },
    { $sort: { "_id.y": 1, "_id.m": 1, "_id.w": 1, "_id.d": 1 } },
  ]);

  const timeseries: StockInvestmentPoint[] = raw.map((r) => ({
    bucket: formatBucketLabel(granularity, r._id, r.bucketStart),
    bucketStart: r.bucketStart,
    totalCostPrice: r.totalCostPrice ?? 0,
    vehicleCount: r.vehicleCount ?? 0,
  }));

  const totals = timeseries.reduce(
    (acc, t) => ({
      totalCostPrice: acc.totalCostPrice + t.totalCostPrice,
      vehicleCount: acc.vehicleCount + t.vehicleCount,
    }),
    { totalCostPrice: 0, vehicleCount: 0 },
  );

  return { granularity, from, to: to ?? null, timeseries, totals };
}
