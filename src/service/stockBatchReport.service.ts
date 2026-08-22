import mongoose from "mongoose";
import { StockConceptCSVModel } from "../models/BikeSystemModel3/StockConceptCSV";
import { CustomerVehicleModel } from "../models/BikeSystemModel2/CustomerVehicleModel";
import { ServiceJobcardRecordModel } from "../models/ServiceJobcard/ServiceJobcardRecord";
import BranchModel from "../models/Branch";
import { BranchScope } from "./rag/scope";

export interface StockBatchReport {
  batchId: string;
  fileName: string;
  uploadDate: Date;
  branchId: string | null;
  branchName: string;
  totalVehicles: number;
  /** Sum of costPrice across every vehicle in the batch — the investment. */
  totalCostPrice: number;
  /** Sold or auto-assigned to a customer (salesInfo.soldTo is set). */
  assignedCount: number;
  /** Never assigned to a customer. */
  leftCount: number;
  /** Sum of salesInfo.salePrice for the assigned vehicles. */
  salesRevenue: number;
  /** Sum of purchasePrice across all VAS activated on this batch's vehicles. */
  vasRevenue: number;
  /** Sum of partsRevenue from service-jobcard rows joined by frame number. */
  partsRevenue: number;
  /** salesRevenue + vasRevenue + partsRevenue. */
  totalRevenue: number;
}

/**
 * Batch-level investment/revenue report for CSV-uploaded stock: how much was
 * put in (totalCostPrice, computed automatically from each row's costPrice —
 * already durably stored on StockConceptCSV) versus how much has come back
 * out (vehicle sale price + VAS activations + parts revenue on serviced
 * vehicles from that same batch, joined by frame number). Computed live on
 * read rather than pre-aggregated and stored, since assigned/left/revenue
 * change continuously as vehicles get sold, serviced, and get VAS added —
 * a stored snapshot would just drift. totalCostPrice is a live SUM too, but
 * over data that's immutable once imported, so it behaves like a stored
 * total without needing a second write path to keep in sync.
 */
export async function computeStockBatchReports(
  scope: BranchScope,
  opts: { page: number; limit: number },
): Promise<{
  data: StockBatchReport[];
  pagination: { page: number; limit: number; total: number; pages: number };
}> {
  const { page, limit } = opts;
  const skip = (page - 1) * limit;
  const branchMatch =
    scope !== "all" ? { "stockStatus.branchId": scope } : {};

  const [batches, distinctBatchIds] = await Promise.all([
    StockConceptCSVModel.aggregate([
      { $match: branchMatch },
      {
        $group: {
          _id: "$csvImportBatch",
          fileName: { $first: "$csvFileName" },
          uploadDate: { $first: "$csvImportDate" },
          branchId: { $first: "$stockStatus.branchId" },
          totalVehicles: { $sum: 1 },
          totalCostPrice: { $sum: { $ifNull: ["$costPrice", 0] } },
          assignedCount: {
            $sum: { $cond: [{ $ifNull: ["$salesInfo.soldTo", false] }, 1, 0] },
          },
          salesRevenue: { $sum: { $ifNull: ["$salesInfo.salePrice", 0] } },
          stockIds: { $push: "$_id" },
          frameNumbers: { $push: "$frameNumber" },
        },
      },
      { $sort: { uploadDate: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]),
    StockConceptCSVModel.distinct("csvImportBatch", branchMatch),
  ]);

  const allStockIds: mongoose.Types.ObjectId[] = batches.flatMap(
    (b) => b.stockIds,
  );
  const allFrameNumbers = [
    ...new Set(batches.flatMap((b) => b.frameNumbers as string[])),
  ];
  const branchIds = [
    ...new Set(batches.map((b) => b.branchId?.toString()).filter(Boolean)),
  ];

  const [vasByStock, partsByFrame, branches] = await Promise.all([
    allStockIds.length
      ? CustomerVehicleModel.aggregate([
          { $match: { stockConcept: { $in: allStockIds } } },
          { $unwind: "$activeValueAddedServices" },
          {
            $group: {
              _id: "$stockConcept",
              vasRevenue: { $sum: "$activeValueAddedServices.purchasePrice" },
            },
          },
        ])
      : Promise.resolve([]),
    allFrameNumbers.length
      ? ServiceJobcardRecordModel.aggregate([
          {
            $match: {
              isActive: true,
              isCurrent: true,
              "normalized.frameNumber": { $in: allFrameNumbers },
            },
          },
          {
            $group: {
              _id: "$normalized.frameNumber",
              partsRevenue: {
                $sum: { $ifNull: ["$normalized.partsRevenue", 0] },
              },
            },
          },
        ])
      : Promise.resolve([]),
    branchIds.length
      ? BranchModel.find({ _id: { $in: branchIds } }).select("branchName")
      : Promise.resolve([]),
  ]);

  const vasMap = new Map<string, number>(
    vasByStock.map((v) => [v._id.toString(), v.vasRevenue as number]),
  );
  const partsMap = new Map<string, number>(
    partsByFrame.map((p) => [p._id as string, p.partsRevenue as number]),
  );
  const branchNameMap = new Map<string, string>(
    branches.map((b: any) => [b._id.toString(), b.branchName]),
  );

  const data: StockBatchReport[] = batches.map((b) => {
    const vasRevenue = (b.stockIds as mongoose.Types.ObjectId[]).reduce(
      (sum, id) => sum + (vasMap.get(id.toString()) ?? 0),
      0,
    );
    const partsRevenue = [...new Set(b.frameNumbers as string[])].reduce(
      (sum, fn) => sum + (partsMap.get(fn) ?? 0),
      0,
    );
    const salesRevenue = b.salesRevenue ?? 0;

    return {
      batchId: b._id,
      fileName: b.fileName,
      uploadDate: b.uploadDate,
      branchId: b.branchId ? b.branchId.toString() : null,
      branchName: b.branchId
        ? (branchNameMap.get(b.branchId.toString()) ?? "Unknown")
        : "Unknown",
      totalVehicles: b.totalVehicles,
      totalCostPrice: b.totalCostPrice,
      assignedCount: b.assignedCount,
      leftCount: b.totalVehicles - b.assignedCount,
      salesRevenue,
      vasRevenue,
      partsRevenue,
      totalRevenue: salesRevenue + vasRevenue + partsRevenue,
    };
  });

  return {
    data,
    pagination: {
      page,
      limit,
      total: distinctBatchIds.length,
      pages: Math.ceil(distinctBatchIds.length / limit),
    },
  };
}
