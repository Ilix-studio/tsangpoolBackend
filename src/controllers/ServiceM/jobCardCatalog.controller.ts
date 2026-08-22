import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";

import { JobCardCatalogItemModel } from "../../models/ServiceM/JobCardCatalogItem";
import {
  isServiceAdmin,
  isBranchManager,
  isAdmin,
  getUserBranch,
} from "../../types/user.types";
import {
  CreateCatalogItemBody,
  UpdateCatalogItemBody,
} from "../../types/jobCard.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolves the branch for the acting user — SA and BM are branch-scoped. */
function resolveActorBranch(user: any): mongoose.Types.ObjectId | null {
  if (isAdmin(user)) return null; // Super-Admin is not branch-scoped
  const branch = getUserBranch(user);
  return branch ? new mongoose.Types.ObjectId(branch) : null;
}

// ─── Create Catalog Item ──────────────────────────────────────────────────────

/**
 * @desc    Create a new catalog item for the user's branch
 * @route   POST /api/job-card-catalog
 * @access  Service-Admin, Branch-Admin
 */
export const createCatalogItem = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      itemType,
      name,
      description,
      defaultUnitPrice,
      defaultTaxRate,
    }: CreateCatalogItemBody = req.body;

    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }

    const branch = resolveActorBranch(req.user);
    if (!branch) {
      res.status(403);
      throw new Error(
        "Super-Admin must specify a branch when creating catalog items",
      );
    }

    if (!itemType || !name || defaultUnitPrice === undefined) {
      res.status(400);
      throw new Error("itemType, name, and defaultUnitPrice are required");
    }
    if (defaultUnitPrice < 0) {
      res.status(400);
      throw new Error("defaultUnitPrice cannot be negative");
    }

    const item = await JobCardCatalogItemModel.create({
      branch,
      itemType,
      name: name.trim(),
      description: description?.trim(),
      defaultUnitPrice,
      defaultTaxRate: defaultTaxRate ?? 18,
      createdBy: (req.user as any)._id,
    });

    res.status(201).json({
      success: true,
      message: "Catalog item created",
      data: item,
    });
  },
);

// ─── List Catalog Items ───────────────────────────────────────────────────────

/**
 * @desc    List active catalog items for the user's branch
 * @route   GET /api/job-card-catalog
 * @access  Service-Admin, Branch-Admin, Super-Admin
 */
export const listCatalogItems = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }

    const { itemType, search, includeInactive } = req.query;
    const query: Record<string, any> = {};

    if (isAdmin(req.user)) {
      // Super-Admin can query across all branches; optional branchId filter
      if (req.query.branchId) query.branch = req.query.branchId;
    } else {
      const branch = resolveActorBranch(req.user);
      query.branch = branch;
    }

    // Only return active items unless explicitly requested otherwise
    if (includeInactive !== "true") query.isActive = true;
    if (itemType) query.itemType = itemType;
    if (search && typeof search === "string") {
      query.name = { $regex: search.trim(), $options: "i" };
    }

    const items = await JobCardCatalogItemModel.find(query).sort({
      itemType: 1,
      name: 1,
    });

    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  },
);

// ─── Update Catalog Item ──────────────────────────────────────────────────────

/**
 * @desc    Update a catalog item (branch-scoped)
 * @route   PATCH /api/job-card-catalog/:id
 * @access  Service-Admin, Branch-Admin
 */
export const updateCatalogItem = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const updates: UpdateCatalogItemBody = req.body;

    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid catalog item ID");
    }

    const item = await JobCardCatalogItemModel.findById(id);
    if (!item) {
      res.status(404);
      throw new Error("Catalog item not found");
    }

    // Enforce branch ownership for non-Super-Admin
    if (!isAdmin(req.user)) {
      const actorBranch = resolveActorBranch(req.user);
      if (item.branch.toString() !== actorBranch?.toString()) {
        res.status(403);
        throw new Error("Cannot modify catalog items from a different branch");
      }
    }

    if (
      updates.defaultUnitPrice !== undefined &&
      updates.defaultUnitPrice < 0
    ) {
      res.status(400);
      throw new Error("defaultUnitPrice cannot be negative");
    }
    if (
      updates.defaultTaxRate !== undefined &&
      (updates.defaultTaxRate < 0 || updates.defaultTaxRate > 100)
    ) {
      res.status(400);
      throw new Error("defaultTaxRate must be between 0 and 100");
    }

    if (updates.name !== undefined) item.name = updates.name.trim();
    if (updates.description !== undefined)
      item.description = updates.description.trim();
    if (updates.defaultUnitPrice !== undefined)
      item.defaultUnitPrice = updates.defaultUnitPrice;
    if (updates.defaultTaxRate !== undefined)
      item.defaultTaxRate = updates.defaultTaxRate;
    if (updates.isActive !== undefined) item.isActive = updates.isActive;

    await item.save();

    res.status(200).json({
      success: true,
      message: "Catalog item updated",
      data: item,
    });
  },
);

// ─── Delete Catalog Item ──────────────────────────────────────────────────────

/**
 * @desc    Hard-delete a catalog item — safe since job card line items snapshot names
 * @route   DELETE /api/job-card-catalog/:id
 * @access  Branch-Admin, Super-Admin
 */
export const deleteCatalogItem = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid catalog item ID");
    }

    const item = await JobCardCatalogItemModel.findById(id);
    if (!item) {
      res.status(404);
      throw new Error("Catalog item not found");
    }

    if (!isAdmin(req.user) && !isBranchManager(req.user)) {
      res.status(403);
      throw new Error(
        "Only Branch-Admin or Super-Admin can delete catalog items",
      );
    }

    if (!isAdmin(req.user)) {
      const actorBranch = resolveActorBranch(req.user);
      if (item.branch.toString() !== actorBranch?.toString()) {
        res.status(403);
        throw new Error("Cannot delete catalog items from a different branch");
      }
    }

    await JobCardCatalogItemModel.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Catalog item deleted",
    });
  },
);
