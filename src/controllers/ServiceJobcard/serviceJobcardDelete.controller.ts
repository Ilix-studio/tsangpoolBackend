import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { ServiceJobcardBatchModel } from "../../models/ServiceJobcard/ServiceJobcardBatch";
import { ServiceJobcardRecordModel } from "../../models/ServiceJobcard/ServiceJobcardRecord";
import { getUserBranch, getUserRole, isAdmin } from "../../types/user.types";

/**
 * @desc    Soft delete a service-jobcard batch (and its rows), audited.
 *          Mirrors the CounterSale soft-delete pattern — rows stay in the
 *          DB with isActive:false, so they drop out of every isActive:true
 *          list/stats query, and getCurrentSnapshot (see
 *          service/ServiceJobcard/serviceJobcardDiff.service.ts) also
 *          filters on isActive, so a deleted batch's Job Card Numbers can
 *          be re-imported later without colliding.
 * @route   DELETE /api/service-jobcard/batches/:batchId
 * @access  Service-Admin (own branch only), Super-Admin (any branch)
 */
export const deleteServiceJobcardBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const batch = await ServiceJobcardBatchModel.findOne({
      batchId,
      isActive: true,
    });
    if (!batch) {
      res.status(404);
      throw new Error("Batch not found");
    }

    if (!isAdmin(req.user!)) {
      const userBranch = getUserBranch(req.user!);
      if (!userBranch || userBranch.toString() !== batch.branchId.toString()) {
        res.status(403);
        throw new Error("Not authorized to delete this branch's import batch");
      }
    }

    batch.isActive = false;
    batch.deletedBy = req.user!._id as typeof batch.deletedBy;
    batch.deletedByRole = getUserRole(req.user!);
    batch.deletedAt = new Date();
    await batch.save();

    await ServiceJobcardRecordModel.updateMany(
      { importBatch: batchId, isActive: true },
      { isActive: false },
    );

    res.status(200).json({
      success: true,
      message: `Service jobcard batch ${batchId} deleted`,
    });
  },
);
