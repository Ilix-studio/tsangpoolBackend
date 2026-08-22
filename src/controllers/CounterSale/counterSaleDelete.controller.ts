import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { CounterSaleReportModel } from "../../models/CounterSaleReport";
import { getUserBranch, getUserRole, isAdmin } from "../../types/user.types";

/**
 * @desc    Soft delete a counter sale batch (all its rows), audited.
 * @route   DELETE /api/counter-sale/batches/:batchId
 * @access  Super-Admin (any), Branch-Admin / Part-Admin (own branch)
 */
export const deleteCounterSaleBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const sample = await CounterSaleReportModel.findOne({
      importBatch: batchId,
      isActive: true,
    });
    if (!sample) {
      res.status(404);
      throw new Error("Counter sale batch not found");
    }

    if (req.user && !isAdmin(req.user)) {
      const ownBranch = getUserBranch(req.user);
      if (!ownBranch || ownBranch !== sample.branchId.toString()) {
        res.status(403);
        throw new Error("Not authorized to delete this branch's import batch");
      }
    }

    await CounterSaleReportModel.updateMany(
      { importBatch: batchId, isActive: true },
      {
        isActive: false,
        deletedBy: req.user!._id,
        deletedByRole: getUserRole(req.user!),
        deletedAt: new Date(),
      },
    );

    res.status(200).json({
      success: true,
      message: `Counter sale batch ${batchId} deleted`,
    });
  },
);

/**
 * @desc    List soft-deleted counter sale batches, with delete audit info.
 * @route   GET /api/counter-sale/deleted-batches
 * @access  Super-Admin only
 */
export const getDeletedCounterSaleBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const batches = await CounterSaleReportModel.aggregate([
      { $match: { isActive: false } },
      {
        $group: {
          _id: "$importBatch",
          fileName: { $first: "$fileName" },
          importDate: { $first: "$importDate" },
          branchId: { $first: "$branchId" },
          uploadedBy: { $first: "$uploadedBy" },
          totalRecords: { $sum: 1 },
          totalInvoice: { $sum: { $ifNull: ["$totalInvoice", 0] } },
          deletedBy: { $first: "$deletedBy" },
          deletedByRole: { $first: "$deletedByRole" },
          deletedAt: { $first: "$deletedAt" },
        },
      },
      { $sort: { deletedAt: -1 } },
      { $limit: 50 },
    ]);

    res.status(200).json({
      success: true,
      data: batches.map((b) => ({
        batchId: b._id,
        fileName: b.fileName,
        importDate: b.importDate,
        branchId: b.branchId,
        totalRecords: b.totalRecords,
        totalInvoice: b.totalInvoice,
        deletedBy: b.deletedBy,
        deletedByRole: b.deletedByRole,
        deletedAt: b.deletedAt,
      })),
    });
  },
);
