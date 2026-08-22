import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  B2BSalesModel,
  getBranchLetterhead,
  IB2BStockItem,
  IB2BExtraItem,
} from "../models/BikeSystemModel2/B2BSalesModel";
import { StockConceptCSVModel } from "../models/BikeSystemModel3/StockConceptCSV";
import { StockConceptModel } from "../models/BikeSystemModel2/StockConcept";
import Branch from "../models/Branch";
import {
  isAdmin,
  isBranchManager,
  getUserBranch,
  extractId,
} from "../types/user.types";
import logger from "../utils/logger";
import {
  CreateB2BSaleBody,
  ExtraItemInput,
  StockItemInput,
  UpdateB2BSaleBody,
} from "../types/b2bSales.types";

/** Branch-Admin is always scoped to their own branch; Super-Admin may filter via ?branchId=. */
function resolveB2BBranchFilter(req: Request): string | undefined {
  if (req.user && isBranchManager(req.user)) {
    return getUserBranch(req.user) || undefined;
  }
  return (req.query.branchId as string) || undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates every selected stock item still belongs to this branch and is
 * Available, and snapshots the fields B2BSalesModel needs. `costPrice` is
 * read directly off StockConceptCSV's real `costPrice` field (not parsed
 * out of the dynamic `csvData` map).
 *
 * `previousStockItemIds` are ids already owned by THIS SAME sale before the
 * current edit — they're allowed through even if their current status is
 * "Sold", since that's this sale's own prior markStockItemsSold() call, not
 * a double-sell. Only genuinely new items must be "Available". Create calls
 * this with an empty array (every item must be Available); update passes
 * the sale's pre-edit item ids.
 */
async function resolveStockItems(
  items: StockItemInput[],
  branchId: string,
  res: Response,
  previousStockItemIds: string[] = [],
): Promise<IB2BStockItem[]> {
  const resolved: IB2BStockItem[] = [];

  for (const item of items) {
    if (
      !item.stockConceptCSVId ||
      !mongoose.Types.ObjectId.isValid(item.stockConceptCSVId)
    ) {
      res.status(400);
      throw new Error("Invalid stock item reference");
    }
    if (!item.quantity || item.quantity < 1) {
      res.status(400);
      throw new Error("Stock item quantity must be at least 1");
    }

    const stock = await StockConceptCSVModel.findById(item.stockConceptCSVId);
    if (!stock || stock.isActive === false) {
      res.status(404);
      throw new Error(`Stock item ${item.stockConceptCSVId} not found`);
    }
    if (stock.stockStatus.branchId.toString() !== branchId) {
      res.status(403);
      throw new Error(`Stock item ${stock.stockId} does not belong to your branch`);
    }
    const alreadyOwnedByThisSale = previousStockItemIds.includes(
      (stock._id as mongoose.Types.ObjectId).toString(),
    );
    if (stock.stockStatus.status !== "Available" && !alreadyOwnedByThisSale) {
      res.status(409);
      throw new Error(
        `Stock item ${stock.stockId} is not Available (status: ${stock.stockStatus.status})`,
      );
    }
    if (stock.costPrice === undefined || stock.costPrice === null) {
      res.status(422);
      throw new Error(`Stock item ${stock.stockId} has no cost price on record`);
    }

    resolved.push({
      stockConceptCSVId: stock._id as mongoose.Types.ObjectId,
      modelName: stock.modelVariant,
      engineNumber: stock.engineNumber,
      chassisNumber: stock.frameNumber,
      costPrice: stock.costPrice,
      quantity: item.quantity,
      totalPrice: stock.costPrice * item.quantity,
    });
  }

  return resolved;
}

/**
 * Flips selected StockConceptCSV rows to Sold / back to Available. No Mongo
 * transactions are used anywhere in this codebase — this write is a
 * sequential follow-up to the challan create/update/cancel write, same
 * non-atomic multi-step risk profile as the rest of the stock controllers.
 */
async function markStockItemsSold(stockConceptCSVIds: string[]): Promise<void> {
  if (stockConceptCSVIds.length === 0) return;
  await StockConceptCSVModel.updateMany(
    { _id: { $in: stockConceptCSVIds } },
    { $set: { "stockStatus.status": "Sold" } },
  );
}

async function markStockItemsAvailable(stockConceptCSVIds: string[]): Promise<void> {
  if (stockConceptCSVIds.length === 0) return;
  await StockConceptCSVModel.updateMany(
    { _id: { $in: stockConceptCSVIds } },
    { $set: { "stockStatus.status": "Available" } },
  );
}

/**
 * Defensive cross-check: a Manual-form (StockConceptModel) record can exist
 * for the same physical bike as a Daily Stock (StockConceptCSV) item — the
 * two collections are only kept apart by application-level duplicate checks,
 * not a DB-level constraint. When a challan sells a CSV item, also flip its
 * Manual-form counterpart (matched by engine/chassis number, same branch) to
 * Sold if one exists and isn't already Sold. Mutates `items` in place,
 * stamping `linkedManualStockId` only on the ones this call actually flipped
 * — that's what lets revertManualStockForItems() safely undo exactly this
 * challan's own effect later, without touching a StockConcept doc that was
 * sold through the normal manual flow.
 */
async function syncManualStockForItems(
  items: IB2BStockItem[],
  branchId: string,
): Promise<void> {
  for (const item of items) {
    const manualDoc = await StockConceptModel.findOne({
      "stockStatus.branchId": branchId,
      $or: [
        { engineNumber: item.engineNumber },
        { chassisNumber: item.chassisNumber },
      ],
    });
    if (manualDoc && manualDoc.stockStatus.status !== "Sold") {
      manualDoc.stockStatus.status = "Sold";
      await manualDoc.save();
      item.linkedManualStockId = manualDoc._id as mongoose.Types.ObjectId;
    }
  }
}

/** Reverts whichever Manual-form records this same challan previously flipped Sold via syncManualStockForItems(). */
async function revertManualStockForItems(items: IB2BStockItem[]): Promise<void> {
  const ids = items.map((i) => i.linkedManualStockId).filter(Boolean);
  if (ids.length === 0) return;
  await StockConceptModel.updateMany(
    { _id: { $in: ids } },
    { $set: { "stockStatus.status": "Available" } },
  );
}

function resolveExtraItems(
  items: ExtraItemInput[],
  res: Response,
): IB2BExtraItem[] {
  return items.map((item) => {
    if (!item.name || !item.name.trim()) {
      res.status(400);
      throw new Error("Extra item name is required");
    }
    if (!item.quantity || item.quantity < 1) {
      res.status(400);
      throw new Error(`Invalid quantity for extra item "${item.name}"`);
    }
    if (item.unitPrice === undefined || item.unitPrice < 0) {
      res.status(400);
      throw new Error(`Invalid unit price for extra item "${item.name}"`);
    }
    return {
      name: item.name.trim(),
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      totalPrice: item.unitPrice * item.quantity,
    };
  });
}

/**
 * DEFAULT Payable Price when the client doesn't send an explicit one — Total
 * Price plus tcsAmount, a flat number (not a percentage) added directly.
 * tcsAmount is genuinely optional — undefined means no TCS, not a real 0.
 * Always meant to stay independently editable, never forcibly overwritten
 * the way totalPrice is.
 */
function computeDefaultPayablePrice(
  stockItems: IB2BStockItem[],
  extraItems: IB2BExtraItem[],
  tcsAmount?: number,
): number {
  const total =
    stockItems.reduce((sum, i) => sum + i.costPrice * i.quantity, 0) +
    extraItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const withTcs = total + (tcsAmount ?? 0);
  return Math.round(withTcs * 100) / 100;
}

/**
 * @desc    Create a B2B sale (challan)
 * @route   POST /api/b2b-sales
 * @access  Branch-Admin
 */
export const createB2BSale = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !isBranchManager(req.user)) {
    res.status(403);
    throw new Error("Only Branch-Admin can create a B2B sale");
  }
  const branchId = getUserBranch(req.user);
  if (!branchId) {
    res.status(400);
    throw new Error("Branch could not be resolved for this account");
  }

  const {
    to,
    topHeading,
    stockItems = [],
    extraItems = [],
    tcsAmount,
    payablePrice,
  } = req.body as CreateB2BSaleBody;

  if (!to || !to.trim()) {
    res.status(400);
    throw new Error("'to' is required");
  }
  if (stockItems.length === 0 && extraItems.length === 0) {
    res.status(400);
    throw new Error("At least one stock item or extra item is required");
  }

  const branch = await Branch.findById(branchId);
  if (!branch) {
    res.status(404);
    throw new Error("Branch not found");
  }

  const resolvedStockItems = await resolveStockItems(stockItems, branchId, res);
  await syncManualStockForItems(resolvedStockItems, branchId);
  const resolvedExtraItems = resolveExtraItems(extraItems, res);

  const resolvedPayablePrice =
    payablePrice !== undefined
      ? payablePrice
      : computeDefaultPayablePrice(resolvedStockItems, resolvedExtraItems, tcsAmount);

  const sale = await B2BSalesModel.create({
    branchId,
    from: branch.branchName,
    to: to.trim(),
    topHeading: topHeading?.trim() || getBranchLetterhead(branch.branchName),
    stockItems: resolvedStockItems,
    extraItems: resolvedExtraItems,
    tcsAmount,
    payablePrice: resolvedPayablePrice,
    createdBy: req.user._id,
  });

  await markStockItemsSold(
    resolvedStockItems.map((i) => i.stockConceptCSVId.toString()),
  );

  logger.info(`B2B sale ${sale.challanNo} created for branch ${branchId}`);

  res.status(201).json({
    success: true,
    message: "B2B sale created",
    data: sale,
  });
});

/**
 * @desc    Single B2B sale
 * @route   GET /api/b2b-sales/:id
 * @access  Super-Admin (any), Branch-Admin (own branch)
 */
export const getB2BSaleById = asyncHandler(async (req: Request, res: Response) => {
  const sale = await B2BSalesModel.findOne({
    _id: req.params.id,
    isActive: true,
  }).populate("branchId", "branchName");

  if (!sale) {
    res.status(404);
    throw new Error("B2B sale not found");
  }

  if (req.user && isBranchManager(req.user)) {
    const ownBranch = getUserBranch(req.user);
    if (!ownBranch || ownBranch !== extractId(sale.branchId)) {
      res.status(403);
      throw new Error("Not authorized to view this branch's B2B sale");
    }
  }

  res.status(200).json({ success: true, data: sale });
});

/**
 * @desc    Paginated list of B2B sales
 * @route   GET /api/b2b-sales
 * @access  Super-Admin (all or ?branchId=), Branch-Admin (own branch)
 */
export const listB2BSales = asyncHandler(async (req: Request, res: Response) => {
  const branch = resolveB2BBranchFilter(req);

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const query: Record<string, any> = { isActive: true };
  if (branch) query.branchId = branch;

  const [sales, total] = await Promise.all([
    B2BSalesModel.find(query)
      .populate("branchId", "branchName")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    B2BSalesModel.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: sales,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Update a B2B sale (challanNo is immutable once set)
 * @route   PUT /api/b2b-sales/:id
 * @access  Branch-Admin (own branch, own record), Super-Admin (any)
 */
export const updateB2BSale = asyncHandler(async (req: Request, res: Response) => {
  const sale = await B2BSalesModel.findOne({
    _id: req.params.id,
    isActive: true,
  });
  if (!sale) {
    res.status(404);
    throw new Error("B2B sale not found");
  }

  if (req.user && isBranchManager(req.user)) {
    const ownBranch = getUserBranch(req.user);
    if (!ownBranch || ownBranch !== sale.branchId.toString()) {
      res.status(403);
      throw new Error("Not authorized to update this branch's B2B sale");
    }
  } else if (!req.user || !isAdmin(req.user)) {
    res.status(403);
    throw new Error("Not authorized to update B2B sales");
  }

  const { to, topHeading, stockItems, extraItems, tcsAmount, payablePrice } =
    req.body as UpdateB2BSaleBody;

  if (to !== undefined) sale.to = to.trim();
  if (topHeading !== undefined) sale.topHeading = topHeading;
  if (tcsAmount !== undefined) sale.tcsAmount = tcsAmount;

  // Captured before any mutation — used after save() to reconcile
  // StockConceptCSV (and linked Manual-form) status against the item-list
  // change (see below).
  const previousStockItemIds = sale.stockItems.map((i) =>
    i.stockConceptCSVId.toString(),
  );
  const previousStockItems: IB2BStockItem[] = sale.stockItems.map((i) => ({
    ...(i as any).toObject(),
  }));

  if (stockItems !== undefined) {
    sale.stockItems = await resolveStockItems(
      stockItems,
      sale.branchId.toString(),
      res,
      previousStockItemIds,
    );

    const newStockItemIds = sale.stockItems.map((i) =>
      i.stockConceptCSVId.toString(),
    );
    const addedIds = newStockItemIds.filter(
      (id) => !previousStockItemIds.includes(id),
    );
    const addedItems = sale.stockItems.filter((i) =>
      addedIds.includes(i.stockConceptCSVId.toString()),
    );
    await syncManualStockForItems(addedItems, sale.branchId.toString());
  }
  if (extraItems !== undefined) {
    sale.extraItems = resolveExtraItems(extraItems, res);
  }

  if (payablePrice !== undefined) {
    sale.payablePrice = payablePrice;
  } else if (
    stockItems !== undefined ||
    extraItems !== undefined ||
    tcsAmount !== undefined
  ) {
    sale.payablePrice = computeDefaultPayablePrice(
      sale.stockItems,
      sale.extraItems,
      sale.tcsAmount,
    );
  }

  await sale.save();

  // Keep StockConceptCSV status in sync with the challan's current item
  // list: items dropped from the challan go back to Available, items newly
  // added get marked Sold. Only run when stockItems was actually part of
  // this update — and only after save() succeeded, so a validation failure
  // never touches inventory. Linked Manual-form records (set above, before
  // save) get the same treatment: dropped items' manual counterparts (if
  // this same challan was the one that flipped them) go back to Available.
  if (stockItems !== undefined) {
    const newStockItemIds = sale.stockItems.map((i) => i.stockConceptCSVId.toString());
    const removedIds = previousStockItemIds.filter((id) => !newStockItemIds.includes(id));
    const addedIds = newStockItemIds.filter((id) => !previousStockItemIds.includes(id));
    const removedItems = previousStockItems.filter((i) =>
      removedIds.includes(i.stockConceptCSVId.toString()),
    );
    await Promise.all([
      markStockItemsAvailable(removedIds),
      markStockItemsSold(addedIds),
      revertManualStockForItems(removedItems),
    ]);
  }

  res.status(200).json({
    success: true,
    message: "B2B sale updated",
    data: sale,
  });
});

/**
 * @desc    Cancel a B2B sale (soft delete + release its stock items back to
 *          Available) — this is the "Cancel Order" action, not a plain
 *          record removal.
 * @route   DELETE /api/b2b-sales/:id
 * @access  Branch-Admin (own branch), Super-Admin (any)
 */
export const deleteB2BSale = asyncHandler(async (req: Request, res: Response) => {
  const sale = await B2BSalesModel.findOne({
    _id: req.params.id,
    isActive: true,
  });
  if (!sale) {
    res.status(404);
    throw new Error("B2B sale not found");
  }

  if (req.user && isBranchManager(req.user)) {
    const ownBranch = getUserBranch(req.user);
    if (!ownBranch || ownBranch !== sale.branchId.toString()) {
      res.status(403);
      throw new Error("Not authorized to cancel this branch's B2B sale");
    }
  } else if (!req.user || !isAdmin(req.user)) {
    res.status(403);
    throw new Error("Not authorized to cancel B2B sales");
  }

  sale.isActive = false;
  await sale.save();

  await Promise.all([
    markStockItemsAvailable(
      sale.stockItems.map((i) => i.stockConceptCSVId.toString()),
    ),
    revertManualStockForItems(sale.stockItems),
  ]);

  res.status(200).json({
    success: true,
    message: `Challan ${sale.challanNo} cancelled — stock released`,
  });
});

/**
 * @desc    Search Available stock in the creator's own branch for challan item selection
 * @route   GET /api/b2b-sales/search-stock?search=...
 * @access  Branch-Admin
 */
export const searchStockForB2BSale = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !isBranchManager(req.user)) {
    res.status(403);
    throw new Error("Only Branch-Admin can search stock for B2B sales");
  }
  const branchId = getUserBranch(req.user);
  if (!branchId) {
    res.status(400);
    throw new Error("Branch could not be resolved for this account");
  }

  const search = String(req.query.search ?? "").trim();

  const query: Record<string, any> = {
    "stockStatus.branchId": branchId,
    "stockStatus.status": "Available",
    isActive: { $ne: false },
  };
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    query.$or = [{ modelVariant: regex }, { engineNumber: regex }];
  }

  // No search term — surface the 5 most recently added Available items as a
  // default picker list; a search term narrows to the 5 best matches instead.
  const results = await StockConceptCSVModel.find(query)
    .select("modelVariant engineNumber frameNumber costPrice stockStatus")
    .sort({ createdAt: -1 })
    .limit(5);

  res.status(200).json({
    success: true,
    data: results.map((s) => ({
      _id: s._id,
      modelName: s.modelVariant,
      engineNumber: s.engineNumber,
      chassisNumber: s.frameNumber,
      costPrice: s.costPrice ?? 0,
      status: s.stockStatus.status,
      location: s.stockStatus.location,
    })),
  });
});

/**
 * @desc    B2B sales KPIs — challan/revenue totals, monthly trend, top items
 * @route   GET /api/b2b-sales/kpis
 * @access  Super-Admin (all or ?branchId=, plus cross-branch breakdown), Branch-Admin (own branch)
 */
export const getB2BSalesKPIs = asyncHandler(async (req: Request, res: Response) => {
  const branch = resolveB2BBranchFilter(req);
  if (branch && !mongoose.Types.ObjectId.isValid(branch)) {
    res.status(400);
    throw new Error("Invalid branch ID");
  }

  const match: Record<string, any> = { isActive: true };
  if (branch) match.branchId = new mongoose.Types.ObjectId(branch);

  const [totals, monthlyTrendRaw, topItemsRaw, branchBreakdownRaw] = await Promise.all([
    B2BSalesModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalChallans: { $sum: 1 },
          totalSalesValue: { $sum: "$totalPrice" },
          totalPayableValue: { $sum: "$payablePrice" },
          // Inner $sum collapses each challan's stockItems.quantity array to
          // one number, the outer accumulator adds those up. Counted here
          // rather than from topItems, which is $limit-ed to 10 models.
          totalVehicles: { $sum: { $sum: "$stockItems.quantity" } },
        },
      },
    ]),
    B2BSalesModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { year: { $year: "$date" }, month: { $month: "$date" } },
          challanCount: { $sum: 1 },
          totalPrice: { $sum: "$totalPrice" },
          payablePrice: { $sum: "$payablePrice" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    B2BSalesModel.aggregate([
      { $match: match },
      { $unwind: "$stockItems" },
      {
        $group: {
          _id: "$stockItems.modelName",
          totalQuantity: { $sum: "$stockItems.quantity" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 },
    ]),
    // Cross-branch breakdown only makes sense when not already scoped to one branch.
    branch
      ? Promise.resolve([])
      : B2BSalesModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: "$branchId",
              challanCount: { $sum: 1 },
              totalPrice: { $sum: "$totalPrice" },
              payablePrice: { $sum: "$payablePrice" },
            },
          },
        ]),
  ]);

  const totalsDoc = totals[0] ?? {
    totalChallans: 0,
    totalSalesValue: 0,
    totalPayableValue: 0,
    totalVehicles: 0,
  };

  let branchBreakdown;
  if (!branch && branchBreakdownRaw.length > 0) {
    const branchIds = branchBreakdownRaw.map((b: any) => b._id);
    const branches = await Branch.find({ _id: { $in: branchIds } }).select(
      "branchName",
    );
    const nameById = new Map(
      branches.map((b) => [(b._id as mongoose.Types.ObjectId).toString(), b.branchName]),
    );
    branchBreakdown = branchBreakdownRaw.map((b: any) => ({
      branchId: b._id.toString(),
      branchName: nameById.get(b._id.toString()),
      challanCount: b.challanCount,
      totalPrice: b.totalPrice,
      payablePrice: b.payablePrice,
    }));
  }

  res.status(200).json({
    success: true,
    data: {
      totalChallans: totalsDoc.totalChallans,
      totalVehicles: totalsDoc.totalVehicles ?? 0,
      totalSalesValue: totalsDoc.totalSalesValue,
      totalPayableValue: totalsDoc.totalPayableValue,
      averageChallanValue:
        totalsDoc.totalChallans > 0
          ? Math.round((totalsDoc.totalSalesValue / totalsDoc.totalChallans) * 100) / 100
          : 0,
      monthlyTrend: monthlyTrendRaw.map((m: any) => ({
        month: `${m._id.year}-${String(m._id.month).padStart(2, "0")}`,
        challanCount: m.challanCount,
        totalPrice: m.totalPrice,
        payablePrice: m.payablePrice,
      })),
      topItems: topItemsRaw.map((t: any) => ({
        modelName: t._id,
        totalQuantity: t.totalQuantity,
      })),
      branchBreakdown,
    },
  });
});
