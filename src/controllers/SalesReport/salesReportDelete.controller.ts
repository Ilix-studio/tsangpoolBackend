import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { SalesReportModel } from "../../models/SalesReport";
import { getUserBranch, getUserRole, isAdmin } from "../../types/user.types";

/**
 * @desc    Soft delete a sales report batch (all its rows), audited. Does
 *          NOT revert matched StockConceptCSV/CustomerVehicle records — soft
 *          delete hides the report rows from audit, consistent with every
 *          other soft-delete flow in this codebase, and reverting
 *          automatically risks clobbering unrelated downstream work on that
 *          vehicle/customer since the sale.
 * @route   DELETE /api/sales-report/batches/:batchId
 * @access  Super-Admin (any), Branch-Admin (own branch)
 */
export const deleteSalesReportBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const sample = await SalesReportModel.findOne({
      importBatch: batchId,
      isActive: true,
    });
    if (!sample) {
      res.status(404);
      throw new Error("Sales report batch not found");
    }

    if (req.user && !isAdmin(req.user)) {
      const ownBranch = getUserBranch(req.user);
      if (!ownBranch || ownBranch !== sample.branchId.toString()) {
        res.status(403);
        throw new Error("Not authorized to delete this branch's import batch");
      }
    }

    await SalesReportModel.updateMany(
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
      message: `Sales report batch ${batchId} deleted`,
    });
  },
);

/**
 * @desc    List soft-deleted sales report batches, with delete audit info.
 * @route   GET /api/sales-report/deleted-batches
 * @access  Super-Admin only
 */
export const getDeletedSalesReportBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const batches = await SalesReportModel.aggregate([
      { $match: { isActive: false } },
      {
        $group: {
          _id: "$importBatch",
          fileName: { $first: "$fileName" },
          importDate: { $first: "$importDate" },
          branchId: { $first: "$branchId" },
          uploadedBy: { $first: "$uploadedBy" },
          totalRecords: { $sum: 1 },
          totalPayment: { $sum: { $ifNull: ["$totalPayment", 0] } },
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
        totalPayment: b.totalPayment,
        deletedBy: b.deletedBy,
        deletedByRole: b.deletedByRole,
        deletedAt: b.deletedAt,
      })),
    });
  },
);
