import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { ImportedDatasetModel } from "../../models/DataImport/ImportedDataset";
import { ImportedRowModel } from "../../models/DataImport/ImportedRow";
import {
  getAllowedDatasetsForRole,
  isDatasetType,
} from "../../models/DataImport/datasetRegistry";
import { getUserBranch, getUserRole, isAdmin, isBranchManager } from "../../types/user.types";

/**
 * Branch filter for dataset/row lists:
 * - Super-Admin: all branches, or the one passed via `?branchId=`.
 * - Branch-scoped roles: forced to their own branch.
 * Returns `null` when a branch is required but missing.
 */
export function branchFilter(req: Request): mongoose.Types.ObjectId | null | "all" {
  if (req.user && isAdmin(req.user)) {
    const q = req.query.branchId as string | undefined;
    if (!q) return "all";
    if (!mongoose.Types.ObjectId.isValid(q)) return null;
    return new mongoose.Types.ObjectId(q);
  }
  const branch = req.user ? getUserBranch(req.user) : null;
  if (!branch || !mongoose.Types.ObjectId.isValid(branch)) return null;
  return new mongoose.Types.ObjectId(branch);
}

/**
 * @desc    Paginated list of imported dataset batches.
 * @route   GET /api/data-import/datasets
 * @access  Any authenticated role (scoped to their branch + allowed dataset types)
 */
export const getDatasets = asyncHandler(async (req: Request, res: Response) => {
  const branch = branchFilter(req);
  if (branch === null) {
    res.status(400);
    throw new Error("Branch could not be resolved");
  }

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const query: Record<string, any> = { isActive: true };
  if (branch !== "all") query.branchId = branch;

  const requestedType = req.query.datasetType as string | undefined;
  if (requestedType) {
    if (!isDatasetType(requestedType)) {
      res.status(400);
      throw new Error("Invalid datasetType");
    }
    query.datasetType = requestedType;
  } else if (!isAdmin(req.user!)) {
    const allowedTypes = getAllowedDatasetsForRole(getUserRole(req.user!)).map(
      (d) => d.datasetType,
    );
    query.datasetType = { $in: allowedTypes };
  }

  const [datasets, total] = await Promise.all([
    ImportedDatasetModel.find(query)
      .populate("branchId", "branchName")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    ImportedDatasetModel.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: datasets,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/**
 * @desc    Paginated list of rows belonging to one import batch.
 * @route   GET /api/data-import/datasets/:batchId/rows
 * @access  Any authenticated role (scoped to their branch)
 */
export const getDatasetRows = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = branchFilter(req);
    if (branch === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const { batchId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const query: Record<string, any> = { batchId, isActive: true };
    if (branch !== "all") query.branchId = branch;

    const [rows, total] = await Promise.all([
      ImportedRowModel.find(query).skip(skip).limit(limit).sort({ createdAt: 1 }),
      ImportedRowModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  },
);

/**
 * @desc    Soft delete an import batch (dataset + its rows).
 * @route   DELETE /api/data-import/datasets/:batchId
 * @access  Super-Admin, Branch-Admin (own branch only)
 */
export const deleteDataset = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const dataset = await ImportedDatasetModel.findOne({ batchId, isActive: true });
    if (!dataset) {
      res.status(404);
      throw new Error("Import batch not found");
    }

    if (isBranchManager(req.user!)) {
      const ownBranch = getUserBranch(req.user!);
      if (!ownBranch || ownBranch !== dataset.branchId.toString()) {
        res.status(403);
        throw new Error("Not authorized to delete this branch's import batch");
      }
    }

    await Promise.all([
      ImportedDatasetModel.updateOne({ _id: dataset._id }, { isActive: false }),
      ImportedRowModel.updateMany({ batchId }, { isActive: false }),
    ]);

    res.status(200).json({
      success: true,
      message: `Import batch ${batchId} deleted`,
    });
  },
);
