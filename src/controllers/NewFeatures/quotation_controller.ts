// controllers/NewFeatures/quotation_controller.ts
import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import QuotationModel, {
  QuotationCreatorModel,
  IQuotationAccessory,
  getQuotationLetterhead,
} from "../../models/NewFeatures/Quotation";
import BikeModel from "../../models/BikeSystemModel/Bikes";
import BikeImageModel from "../../models/BikeSystemModel/BikeImageModel";
import ValueAddedServiceModel from "../../models/BikeSystemModel2/VASmodel";
import Branch from "../../models/Branch";
import {
  isAdmin,
  canAccessBranch,
  extractBranchId,
  getUserBranch,
} from "../../types/user.types";
import logger from "../../utils/logger";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CREATOR_MODEL_MAP: Record<string, QuotationCreatorModel> = {
  "Branch-Admin": "BranchManager",
  Staff: "Staff",
};

function getCreatorModel(role: string): QuotationCreatorModel {
  const model = CREATOR_MODEL_MAP[role];
  if (!model)
    throw Object.assign(new Error("Only Branch-Admin or Staff can create quotations"), {
      statusCode: 403,
    });
  return model;
}

async function resolveBikeSnapshot(bikeId: string) {
  if (!mongoose.Types.ObjectId.isValid(bikeId)) {
    throw Object.assign(new Error("Invalid bike ID"), { statusCode: 400 });
  }

  const bike = await BikeModel.findOne({ _id: bikeId, isActive: true });
  if (!bike) {
    throw Object.assign(
      new Error(
        "This vehicle is not available in the catalog. Add it to the bike catalog first.",
      ),
      { statusCode: 404 },
    );
  }

  const primaryImage =
    (await BikeImageModel.findOne({ bikeId: bike._id, isPrimary: true, isActive: true })
      .select("src alt")
      .lean()) ??
    (await BikeImageModel.findOne({ bikeId: bike._id, isActive: true })
      .select("src alt")
      .sort({ createdAt: 1 })
      .lean());

  return { bike, primaryImage };
}

function resolveAccessories(input: unknown): IQuotationAccessory[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (a) =>
        a &&
        typeof a.name === "string" &&
        a.name.trim() &&
        Number(a.quantity) > 0 &&
        Number(a.amount) >= 0,
    )
    .map((a) => ({
      name: String(a.name).trim(),
      quantity: Number(a.quantity),
      amount: Number(a.amount),
    }));
}

// ─── Create Quotation ─────────────────────────────────────────────────────────

/**
 * @desc    Create a quotation for a bike
 * @route   POST /api/quotations
 * @access  Branch-Admin, Staff
 */
export const createQuotation = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const {
      bikeId,
      pricingType = "standard",
      exShowroomPrice,
      onRoadTax,
      variation,
      insurance,
      vasSelections,
      accessories,
      to,
      topHeading,
      bankDetails,
      termsAndConditions,
    } = req.body;

    if (!bikeId) {
      res.status(400);
      throw new Error("bikeId is required");
    }

    if (!["standard", "variation"].includes(pricingType)) {
      res.status(400);
      throw new Error("pricingType must be standard or variation");
    }

    if (!to?.name?.trim() || !to?.phone?.trim() || !to?.addressLine1?.trim()) {
      res.status(400);
      throw new Error("to.name, to.phone, and to.addressLine1 are required");
    }

    if (pricingType === "variation") {
      if (
        !variation?.label ||
        variation?.price === undefined ||
        variation?.onRoadPrice === undefined
      ) {
        res.status(400);
        throw new Error(
          "variation.label, variation.price, and variation.onRoadPrice are required for a variation quotation",
        );
      }
    }

    const { bike, primaryImage } = await resolveBikeSnapshot(bikeId);

    const userRole = (req.user as any).role ?? "Staff";
    const createdByModel = getCreatorModel(userRole);
    const branchId = getUserBranch(req.user);

    if (!branchId) {
      res.status(400);
      throw new Error("User branch not found");
    }

    const branch = await Branch.findById(branchId);
    if (!branch) {
      res.status(404);
      throw new Error("Branch not found");
    }

    // Pre-fill from the bike's own price breakdown if the caller didn't
    // supply an override — these are then stored independently on the
    // quotation, not linked live to the bike.
    const resolvedExShowroom =
      pricingType === "standard"
        ? exShowroomPrice ?? bike.priceBreakdown.exShowroomPrice
        : 0;
    const resolvedOnRoadTax =
      pricingType === "standard"
        ? onRoadTax ??
          (bike.priceBreakdown.onRoadPrice ?? bike.priceBreakdown.exShowroomPrice) -
            bike.priceBreakdown.exShowroomPrice
        : 0;

    // Snapshot + validate any VAS selections supplied.
    let resolvedVasSelections: { vas: mongoose.Types.ObjectId; serviceName: string; price: number }[] = [];
    if (Array.isArray(vasSelections) && vasSelections.length > 0) {
      const vasIds = vasSelections
        .map((v: any) => v.vasId)
        .filter((id: string) => mongoose.Types.ObjectId.isValid(id));
      const vasDocs = await ValueAddedServiceModel.find({ _id: { $in: vasIds } });
      resolvedVasSelections = vasDocs.map((v) => ({
        vas: v._id as unknown as mongoose.Types.ObjectId,
        serviceName: v.serviceName,
        price: v.priceStructure.basePrice,
      }));
    }

    const quotation = await QuotationModel.create({
      bike: bike._id,
      bikeSnapshot: {
        modelName: bike.modelName,
        category: bike.category,
        mainCategory: bike.mainCategory,
        image: primaryImage ? { src: primaryImage.src, alt: primaryImage.alt } : undefined,
      },
      pricingType,
      exShowroomPrice: resolvedExShowroom,
      onRoadTax: resolvedOnRoadTax,
      variation: pricingType === "variation" ? variation : undefined,
      insurance,
      vasSelections: resolvedVasSelections,
      accessories: resolveAccessories(accessories),
      to: {
        name: to.name.trim(),
        phone: to.phone.trim(),
        addressLine1: to.addressLine1.trim(),
        addressLine2: to.addressLine2?.trim() || undefined,
      },
      topHeading: topHeading?.trim() || getQuotationLetterhead(branch.branchName),
      bankDetails,
      termsAndConditions,
      createdBy: req.user._id,
      createdByModel,
      createdByRole: userRole,
      branch: branchId,
    });

    logger.info(`Quotation created: ${quotation.quotationNo} by ${req.user._id} (${userRole})`);

    res.status(201).json({ success: true, message: "Quotation created", data: quotation });
  },
);

// ─── List Quotations ──────────────────────────────────────────────────────────

/**
 * @desc    List quotations — Super-Admin global, others branch-scoped
 * @route   GET /api/quotations
 * @access  Branch-Admin, Staff
 */
export const getQuotations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { page = 1, limit = 20 } = req.query as Record<string, any>;
  const filter: Record<string, unknown> = {};

  if (isAdmin(req.user)) {
    if (req.query.branch) filter.branch = req.query.branch;
  } else {
    filter.branch = getUserBranch(req.user);
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    QuotationModel.find(filter)
      .populate("branch", "branchName address")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    QuotationModel.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum),
    data,
  });
});

// ─── Get Quotation By Id ──────────────────────────────────────────────────────

/**
 * @desc    Get a single quotation
 * @route   GET /api/quotations/:id
 * @access  Branch-Admin, Staff
 */
export const getQuotationById = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid quotation ID");
  }

  const quotation = await QuotationModel.findById(id).populate(
    "branch",
    "branchName address phone email",
  );

  if (!quotation) {
    res.status(404);
    throw new Error("Quotation not found");
  }

  if (!isAdmin(req.user) && !canAccessBranch(req.user, extractBranchId(quotation.branch))) {
    res.status(403);
    throw new Error("Access denied: branch mismatch");
  }

  res.status(200).json({ success: true, data: quotation });
});

// ─── Update Quotation ─────────────────────────────────────────────────────────

/**
 * @desc    Update a quotation (pricing, insurance, VAS)
 * @route   PATCH /api/quotations/:id
 * @access  Branch-Admin, Staff (own branch only)
 */
export const updateQuotation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid quotation ID");
  }

  const quotation = await QuotationModel.findById(id);
  if (!quotation) {
    res.status(404);
    throw new Error("Quotation not found");
  }

  if (!isAdmin(req.user) && !canAccessBranch(req.user, extractBranchId(quotation.branch))) {
    res.status(403);
    throw new Error("Access denied: branch mismatch");
  }

  const {
    pricingType,
    exShowroomPrice,
    onRoadTax,
    variation,
    insurance,
    vasSelections,
    accessories,
    to,
    topHeading,
    bankDetails,
    termsAndConditions,
  } = req.body;

  if (pricingType !== undefined) quotation.pricingType = pricingType;
  if (exShowroomPrice !== undefined) quotation.exShowroomPrice = exShowroomPrice;
  if (onRoadTax !== undefined) quotation.onRoadTax = onRoadTax;
  if (variation !== undefined) quotation.variation = variation;
  if (insurance !== undefined) quotation.insurance = insurance;
  if (accessories !== undefined) quotation.accessories = resolveAccessories(accessories);
  if (topHeading !== undefined) quotation.topHeading = topHeading;
  if (bankDetails !== undefined) quotation.bankDetails = bankDetails;
  if (termsAndConditions !== undefined) quotation.termsAndConditions = termsAndConditions;
  if (to !== undefined) {
    if (!to?.name?.trim() || !to?.phone?.trim() || !to?.addressLine1?.trim()) {
      res.status(400);
      throw new Error("to.name, to.phone, and to.addressLine1 are required");
    }
    quotation.to = {
      name: to.name.trim(),
      phone: to.phone.trim(),
      addressLine1: to.addressLine1.trim(),
      addressLine2: to.addressLine2?.trim() || undefined,
    };
  }

  if (Array.isArray(vasSelections)) {
    const vasIds = vasSelections
      .map((v: any) => v.vasId)
      .filter((vid: string) => mongoose.Types.ObjectId.isValid(vid));
    const vasDocs = await ValueAddedServiceModel.find({ _id: { $in: vasIds } });
    quotation.vasSelections = vasDocs.map((v) => ({
      vas: v._id as unknown as mongoose.Types.ObjectId,
      serviceName: v.serviceName,
      price: v.priceStructure.basePrice,
    }));
  }

  await quotation.save();

  res.status(200).json({ success: true, message: "Quotation updated", data: quotation });
});

// ─── Delete Quotation ─────────────────────────────────────────────────────────

/**
 * @desc    Delete a quotation
 * @route   DELETE /api/quotations/:id
 * @access  Branch-Admin, Staff (own branch only)
 */
export const deleteQuotation = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid quotation ID");
  }

  const quotation = await QuotationModel.findById(id);
  if (!quotation) {
    res.status(404);
    throw new Error("Quotation not found");
  }

  if (!isAdmin(req.user) && !canAccessBranch(req.user, extractBranchId(quotation.branch))) {
    res.status(403);
    throw new Error("Access denied: branch mismatch");
  }

  await QuotationModel.findByIdAndDelete(id);

  res.status(200).json({ success: true, message: "Quotation deleted" });
});

// ─── Bulk Mark Quotations Expired (price increase, by cutoff date) ────────────

/**
 * @desc    Bulk-marks every not-yet-expired quotation issued before a
 *          Branch-Admin-chosen cutoff date as expired due to a price
 *          increase — e.g. "prices went up on 1 Aug" expires every quotation
 *          created before 1 Aug in one action, instead of one at a time. The
 *          cutoff is a business decision the admin makes; it isn't compared
 *          against any live catalog price.
 * @route   PATCH /api/quotations/bulk-expire
 * @body    { beforeDate: string; branch?: string }
 *          beforeDate — ISO date; quotations with createdAt < this are expired.
 *          branch — required for Super-Admin (no "all branches" bulk-expire);
 *          ignored for Branch-Admin/Staff, whose own branch is always used.
 * @access  Branch-Admin, Staff (own branch only), Super-Admin (via body.branch)
 */
export const bulkExpireQuotationsBeforeDate = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const { beforeDate } = req.body;
    if (!beforeDate || Number.isNaN(Date.parse(beforeDate))) {
      res.status(400);
      throw new Error("A valid beforeDate is required");
    }

    const cutoff = new Date(beforeDate);

    let branchId: unknown;
    if (isAdmin(req.user)) {
      if (!req.body.branch) {
        res.status(400);
        throw new Error("branch is required");
      }
      branchId = req.body.branch;
    } else {
      branchId = getUserBranch(req.user);
      if (!branchId) {
        res.status(400);
        throw new Error("User branch not found");
      }
    }

    const expiredReason = `Price increased effective ${cutoff.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    })}`;

    const result = await QuotationModel.updateMany(
      { branch: branchId, createdAt: { $lt: cutoff }, isExpired: false },
      { $set: { isExpired: true, expiredAt: new Date(), expiredReason } },
    );

    logger.info(
      `Bulk-expired ${result.modifiedCount} quotation(s) before ${cutoff.toISOString()} (branch ${branchId}) by ${req.user._id}`,
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} quotation(s) marked expired due to price increase`,
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        cutoffDate: cutoff,
        expiredReason,
      },
    });
  },
);

// ─── Public Quotation (unauthenticated share link) ────────────────────────────

/**
 * @desc    Read a quotation via its public share link — no login required.
 *          Gated on quotationNo + publicToken both matching so the link
 *          can't be guessed/enumerated from the quotation number alone.
 * @route   GET /api/quotations/public/:quotationNo/:token
 * @access  Public
 */
export const getPublicQuotation = asyncHandler(async (req: Request, res: Response) => {
  const { quotationNo, token } = req.params;

  const quotation = await QuotationModel.findOne({
    quotationNo,
    publicToken: token,
  }).populate("branch", "branchName address phone email");

  if (!quotation) {
    res.status(404);
    throw new Error("Quotation not found");
  }

  res.status(200).json({ success: true, data: quotation });
});
