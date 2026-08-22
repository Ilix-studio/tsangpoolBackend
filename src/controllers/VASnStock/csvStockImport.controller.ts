import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { parse } from "csv-parse";
import * as XLSX from "xlsx";

import { detectCSVSchema } from "../../utils/csvSchemaDetector";
import { StockConceptCSVModel } from "../../models/BikeSystemModel3/StockConceptCSV";
import mongoose, { Types } from "mongoose";
import { StockConceptModel } from "../../models/BikeSystemModel2/StockConcept";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";
import { SalesReportModel } from "../../models/SalesReport";
import { getUserBranch, isBranchManager } from "../../types/user.types";
import { attachCustomerProfiles } from "../../service/attachCustomerProfiles";

/** Branch-Admin is always scoped to their own branch; Super-Admin may filter via ?branchId=. */
function resolveCSVStockBranchFilter(req: Request): string | undefined {
  if (req.user && isBranchManager(req.user)) {
    // `branch` may be a populated document ({_id, branchName, ...}) or a raw
    // ObjectId depending on how `protect` resolved the user — getUserBranch
    // handles both.
    return getUserBranch(req.user) || undefined;
  }
  return (req.query.branchId as string) || undefined;
}

function parseCSVBuffer(buffer: Buffer): Promise<Record<string, any>[]> {
  return new Promise((resolve, reject) => {
    parse(
      buffer,
      {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      },
      (err, output: unknown) => {
        if (err) reject(err);
        else resolve(output as Record<string, any>[]);
      }
    );
  });
}

/** Parses the first sheet of an XLSX/XLS workbook via SheetJS. */
function parseSpreadsheetBuffer(buffer: Buffer): Record<string, any>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });
}

export const importCSVStock = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;

    if (!file) {
      res.status(400);
      throw new Error("CSV/Excel file required");
    }

    const branchId = getUserBranch(req.user!);
    if (!branchId) {
      res.status(400);
      throw new Error("Branch could not be resolved for this account");
    }

    const isCSV =
      file.mimetype === "text/csv" ||
      file.originalname.toLowerCase().endsWith(".csv");
    const records = isCSV
      ? await parseCSVBuffer(file.buffer)
      : parseSpreadsheetBuffer(file.buffer);

    // Detect schema
    const schema = detectCSVSchema(records);

    // Generate batch ID
    const batchId = `CSV-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;
    const importDate = new Date();

    const results = {
      success: false,
      totalRows: records.length,
      successCount: 0,
      failureCount: 0,
      batchId,
      detectedColumns: schema.columns,
      errors: [] as any[],
      created: [] as string[],
    };

    // Process records
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 2;

      try {
        // Extract core fields using detected mappings
        const modelVariant = row[schema.mappings.modelVariant];
        const engineNumber = row[schema.mappings.engineNumber]?.toUpperCase();
        const frameNumber = row[schema.mappings.frameNumber]?.toUpperCase();
        const color = row[schema.mappings.color];
        const location =
          row[schema.mappings.location]?.toUpperCase() || "WAREHOUSE";
        const costPrice = schema.mappings.costPrice
          ? parseFloat(String(row[schema.mappings.costPrice]).replace(/[,₹$\s]/g, ""))
          : undefined;

        if (!engineNumber || !frameNumber) {
          throw new Error("Engine/Frame number missing");
        }

        // Check duplicates across BOTH models
        const [existingCSV, existingStock] = await Promise.all([
          StockConceptCSVModel.findOne({
            $or: [{ engineNumber }, { frameNumber }],
          }),
          mongoose.model("StockConcept").findOne({
            $or: [{ engineNumber }, { chassisNumber: frameNumber }],
          }),
        ]);

        if (existingCSV || existingStock) {
          throw new Error(`Duplicate: ${engineNumber || frameNumber}`);
        }

        // Cross-check against SalesReport: a dealer "already sold" export may
        // have been uploaded before this stock row existed, in which case
        // the SalesReport row was left "unmatched". Catch that here so the
        // stock row is created directly as Sold instead of briefly (and
        // wrongly) showing Available.
        const matchingSalesReport = await SalesReportModel.findOne({
          branchId,
          isActive: true,
          $or: [{ frameNo: frameNumber }, { engineNo: engineNumber }],
        });

        // Generate stock ID
        const stockCount = await StockConceptCSVModel.countDocuments();
        const stockId = `CSV-${Date.now()}-${String(stockCount + 1).padStart(
          4,
          "0"
        )}`;

        // Create with ALL CSV data
        const csvStock = await StockConceptCSVModel.create({
          stockId,
          modelVariant,
          engineNumber,
          frameNumber,
          color,
          costPrice: Number.isFinite(costPrice) ? costPrice : undefined,
          creationSource: "csv_import",

          csvImportBatch: batchId,
          csvImportDate: importDate,
          csvFileName: file.originalname,

          // Store ALL columns dynamically
          csvData: row,
          detectedColumns: schema.columns,
          schemaVersion: 1,

          stockStatus: {
            status: matchingSalesReport ? "Sold" : "Available",
            location,
            branchId,
            updatedBy: req.user!._id,
          },
        });

        if (matchingSalesReport && !matchingSalesReport.matched) {
          matchingSalesReport.matched = true;
          matchingSalesReport.needsReview = false;
          matchingSalesReport.matchOutcome = "matched_status_flipped";
          matchingSalesReport.matchedStockId =
            csvStock._id as mongoose.Types.ObjectId;
          matchingSalesReport.matchedStockType = "StockConceptCSV";
          await matchingSalesReport.save();
        }

        results.created.push(csvStock.stockId);
        results.successCount++;
      } catch (error) {
        results.failureCount++;
        results.errors.push({
          row: rowNumber,
          data: row,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    results.success = results.failureCount === 0;

    res.status(results.success ? 201 : 207).json({
      success: true,
      message: `Imported ${results.successCount}/${results.totalRows}`,
      data: results,
    });
  }
);

// Get all CSV stocks
export const getCSVStocks = asyncHandler(
  async (req: Request, res: Response) => {
    const { page = 1, limit = 20, batchId, status, location } = req.query;

    // Exclude auto-registration placeholders (created from service-jobcard
    // walk-ins, not an actual CSV upload) — this view is for real CSV imports.
    // Also exclude soft-deleted stocks.
    const query: any = {
      creationSource: "csv_import",
      isActive: { $ne: false },
    };
    if (batchId) query.csvImportBatch = batchId;
    if (status) query["stockStatus.status"] = status;
    if (location) query["stockStatus.location"] = location;
    const branchFilter = resolveCSVStockBranchFilter(req);
    if (branchFilter) query["stockStatus.branchId"] = branchFilter;

    const skip = (Number(page) - 1) * Number(limit);

    const [stocks, total] = await Promise.all([
      StockConceptCSVModel.find(query)
        .populate("stockStatus.branchId", "branchName")
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      StockConceptCSVModel.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: stocks,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  }
);

export const assignCSVStockToCustomer = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockId } = req.params;
    const {
      customerId,
      salePrice,
      invoiceNumber,
      paymentStatus = "Pending",
      registrationDate,
      numberPlate,
      registeredOwnerName,
      insurance,
      isPaid = true,
      isFinance,
    } = req.body;

    if (!customerId || !salePrice || !invoiceNumber) {
      res.status(400);
      throw new Error("customerId, salePrice, and invoiceNumber are required");
    }

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      res.status(400);
      throw new Error("Invalid customerId");
    }

    // Support both _id (ObjectId) and stockId (string) lookup
    const isObjectId =
      mongoose.Types.ObjectId.isValid(stockId) && stockId.length === 24;
    const query = isObjectId ? { _id: stockId } : { stockId };

    const stock = await StockConceptCSVModel.findOne(query);
    if (!stock) {
      res.status(404);
      throw new Error("CSV stock not found");
    }

    if (stock.stockStatus.status !== "Available") {
      res.status(409);
      throw new Error("Stock is not available for assignment");
    }

    // Check customer exists
    const { BaseCustomerModel } = await import(
      "../../models/CustomerSystem/BaseCustomer"
    );
    const customer = await BaseCustomerModel.findById(customerId);
    if (!customer) {
      res.status(404);
      throw new Error("Customer not found");
    }

    // Check customer doesn't already have a vehicle
    const existingVehicle = await CustomerVehicleModel.findOne({
      customer: customerId,
    });
    if (existingVehicle) {
      res.status(409);
      throw new Error("Customer already has a vehicle assigned");
    }

    const customerVehicle = await CustomerVehicleModel.create({
      stockConcept: stock._id,
      stockType: "StockConceptCSV",
      customer: customerId,
      registrationDate,
      numberPlate,
      registeredOwnerName,
      isPaid,
      isFinance,
      insurance,
    });

    stock.stockStatus.status = "Sold";
    stock.salesInfo = {
      soldTo: new Types.ObjectId(customerId),
      soldDate: new Date(),
      salePrice: Number(salePrice),
      invoiceNumber,
      paymentStatus,
      customerVehicleId: new Types.ObjectId(customerVehicle._id as string),
    };

    await stock.save();

    res.status(200).json({
      success: true,
      message: "CSV stock assigned successfully",
      data: { stock, customerVehicle },
    });
  }
);

/**
 * @desc    Get stocks from specific CSV batch
 * @route   GET /api/stock-concept/csv-batch/:batchId
 * @access  Private (Admin)
 */
export const getStocksByCSVBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const stocks = await StockConceptModel.find({
      csvImportBatch: batchId,
    })
      .populate("stockStatus.branchId", "branchName address")
      .sort({ createdAt: 1 });

    if (stocks.length === 0) {
      res.status(404);
      throw new Error("No stocks found for this batch ID");
    }

    res.status(200).json({
      success: true,
      batchId,
      count: stocks.length,
      data: stocks,
    });
  }
);
// Get single CSV stock
export const getCSVStockByStockId = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockId } = req.params;

    const stock = await StockConceptCSVModel.findOne({ stockId })
      .populate("stockStatus.branchId", "branchName address")
      .populate("salesInfo.soldTo", "fullName phoneNumber")
      .populate("salesInfo.customerVehicleId");

    if (!stock) {
      res.status(404);
      throw new Error("CSV stock not found");
    }

    res.json({
      success: true,
      data: stock,
    });
  }
);
// Get CSV batches (folders)
export const getCSVBatches = asyncHandler(
  async (req: Request, res: Response) => {
    const { page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const branchFilter = resolveCSVStockBranchFilter(req);
    // Exclude auto-registration placeholders (created from service-jobcard
    // walk-ins, not an actual CSV upload) — this view is for real CSV imports.
    // Also exclude soft-deleted stocks so deleted folders disappear.
    const baseFilter: Record<string, any> = {
      creationSource: "csv_import",
      isActive: { $ne: false },
    };
    if (branchFilter) {
      baseFilter["stockStatus.branchId"] = new mongoose.Types.ObjectId(branchFilter);
    }
    const matchStage = [{ $match: baseFilter }];

    const batches = await StockConceptCSVModel.aggregate([
      ...matchStage,
      {
        $group: {
          _id: "$csvImportBatch",
          fileName: { $first: "$csvFileName" },
          importDate: { $first: "$csvImportDate" },
          totalStocks: { $sum: 1 },
          availableStocks: {
            $sum: {
              $cond: [{ $eq: ["$stockStatus.status", "Available"] }, 1, 0],
            },
          },
          soldStocks: {
            $sum: {
              $cond: [{ $eq: ["$stockStatus.status", "Sold"] }, 1, 0],
            },
          },
          totalCostPrice: { $sum: { $ifNull: ["$costPrice", 0] } },
          models: { $addToSet: "$modelVariant" },
          locations: { $addToSet: "$stockStatus.location" },
        },
      },
      { $sort: { importDate: -1 } },
      { $skip: skip },
      { $limit: Number(limit) },
    ]);

    const totalBatches = await StockConceptCSVModel.distinct(
      "csvImportBatch",
      baseFilter,
    );

    res.json({
      success: true,
      data: batches.map((b) => ({
        batchId: b._id,
        fileName: b.fileName,
        importDate: b.importDate,
        totalStocks: b.totalStocks,
        availableStocks: b.availableStocks,
        soldStocks: b.soldStocks,
        totalCostPrice: b.totalCostPrice,
        models: b.models,
        locations: b.locations,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalBatches.length,
        pages: Math.ceil(totalBatches.length / Number(limit)),
      },
    });
  }
);

// Get CSV import batches for a single calendar day (by csvImportDate)
export const getCSVBatchesByDate = asyncHandler(
  async (req: Request, res: Response) => {
    const dateParam = String(req.query.date ?? "").trim();
    if (!dateParam) {
      res.status(400);
      throw new Error("date query parameter is required");
    }

    const [year, month, day] = dateParam.split("-").map((part) => Number(part));
    if (!year || !month || !day) {
      res.status(400);
      throw new Error("date must be in YYYY-MM-DD format");
    }

    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    const branchFilter = resolveCSVStockBranchFilter(req);
    // Same exclusions as getCSVBatches — this view is for real CSV imports only.
    const baseFilter: Record<string, any> = {
      creationSource: "csv_import",
      isActive: { $ne: false },
      csvImportDate: { $gte: startOfDay, $lt: endOfDay },
    };
    if (branchFilter) {
      baseFilter["stockStatus.branchId"] = new mongoose.Types.ObjectId(branchFilter);
    }

    const batches = await StockConceptCSVModel.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: "$csvImportBatch",
          fileName: { $first: "$csvFileName" },
          importDate: { $first: "$csvImportDate" },
          totalStocks: { $sum: 1 },
          availableStocks: {
            $sum: {
              $cond: [{ $eq: ["$stockStatus.status", "Available"] }, 1, 0],
            },
          },
          soldStocks: {
            $sum: {
              $cond: [{ $eq: ["$stockStatus.status", "Sold"] }, 1, 0],
            },
          },
          totalCostPrice: { $sum: { $ifNull: ["$costPrice", 0] } },
          models: { $addToSet: "$modelVariant" },
          locations: { $addToSet: "$stockStatus.location" },
        },
      },
      { $sort: { importDate: -1 } },
    ]);

    res.json({
      success: true,
      data: batches.map((b) => ({
        batchId: b._id,
        fileName: b.fileName,
        importDate: b.importDate,
        totalStocks: b.totalStocks,
        availableStocks: b.availableStocks,
        soldStocks: b.soldStocks,
        totalCostPrice: b.totalCostPrice,
        models: b.models,
        locations: b.locations,
      })),
    });
  }
);

// Get stocks by batch (files in folder)
export const getStocksByBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;
    const { page = 1, limit = 50, status } = req.query;

    const query: any = {
      csvImportBatch: batchId,
      creationSource: "csv_import",
      isActive: { $ne: false },
    };
    if (status) query["stockStatus.status"] = status;
    const branchFilter = resolveCSVStockBranchFilter(req);
    if (branchFilter) query["stockStatus.branchId"] = branchFilter;

    const skip = (Number(page) - 1) * Number(limit);

    const [stocks, total] = await Promise.all([
      StockConceptCSVModel.find(query)
        .populate("stockStatus.branchId", "branchName")
        .populate("salesInfo.soldTo", "fullName phoneNumber")
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: 1 }),
      StockConceptCSVModel.countDocuments(query),
    ]);

    if (stocks.length === 0) {
      res.status(404);
      throw new Error("Batch not found");
    }

    res.json({
      success: true,
      batchId,
      data: stocks,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  }
);

// Update stock status
export const updateCSVStockStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockId } = req.params;
    const { status, location } = req.body;

    const validStatuses = ["Available", "Sold", "Reserved", "Service"];
    if (status && !validStatuses.includes(status)) {
      res.status(400);
      throw new Error("Invalid status");
    }

    const stock = await StockConceptCSVModel.findOne({ stockId });

    if (!stock) {
      res.status(404);
      throw new Error("Stock not found");
    }

    if (status) stock.stockStatus.status = status;
    if (location) stock.stockStatus.location = location.toUpperCase();
    stock.stockStatus.updatedBy = req.user!._id as mongoose.Types.ObjectId;

    await stock.save();

    res.json({
      success: true,
      message: "Status updated",
      data: stock,
    });
  }
);

// Soft delete CSV stock
export const deleteCSVStock = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockId } = req.params;

    const stock = await StockConceptCSVModel.findOne({ stockId });

    if (!stock) {
      res.status(404);
      throw new Error("Stock not found");
    }

    if (stock.stockStatus.status === "Sold") {
      res.status(400);
      throw new Error("Cannot delete sold stock");
    }

    stock.isActive = false;
    await stock.save();

    res.json({
      success: true,
      message: "Stock deleted",
    });
  }
);

// Soft delete an entire CSV batch (folder). Refuses if any stock in the batch
// is already sold, mirroring the single-stock delete safeguard.
export const deleteCSVBatch = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const query: any = {
      csvImportBatch: batchId,
      creationSource: "csv_import",
      isActive: { $ne: false },
    };
    const branchFilter = resolveCSVStockBranchFilter(req);
    if (branchFilter) query["stockStatus.branchId"] = branchFilter;

    const stocks = await StockConceptCSVModel.find(query).select(
      "stockStatus.status"
    );

    if (stocks.length === 0) {
      res.status(404);
      throw new Error("Batch not found");
    }

    const soldCount = stocks.filter(
      (s) => s.stockStatus.status === "Sold"
    ).length;
    if (soldCount > 0) {
      res.status(400);
      throw new Error(
        `Cannot delete batch: ${soldCount} stock(s) already sold`
      );
    }

    const result = await StockConceptCSVModel.updateMany(query, {
      $set: { isActive: false },
    });

    res.json({
      success: true,
      message: `Batch deleted (${result.modifiedCount} stock(s) removed)`,
    });
  }
);

// Unassign (reverse assignment)
export const unassignCSVStock = asyncHandler(
  async (req: Request, res: Response) => {
    const { stockId } = req.params;
    const { reason } = req.body;

    const stock = await StockConceptCSVModel.findOne({ stockId });

    if (!stock) {
      res.status(404);
      throw new Error("Stock not found");
    }

    if (stock.stockStatus.status !== "Sold") {
      res.status(400);
      throw new Error("Stock not assigned");
    }

    const customerVehicleId = stock.salesInfo?.customerVehicleId;

    // Delete customer vehicle record
    if (customerVehicleId) {
      await CustomerVehicleModel.findByIdAndDelete(customerVehicleId);
    }

    // Reset stock
    stock.stockStatus.status = "Available";
    stock.salesInfo = undefined;

    await stock.save();

    res.json({
      success: true,
      message: "Stock unassigned",
      data: stock,
      reason,
    });
  }
);

/**
 * @desc    CSV-imported stock that has been assigned to a customer, with the
 *          buyer's profile attached. Peer of `getAssignedStockWithCustomers`
 *          (manual StockConcept assignments) — the Sales Report screen shows
 *          the two side by side.
 * @route   GET /api/csv-stock/assigned
 * @access  Private (Super-Admin, Branch-Admin)
 */
export const getAssignedCSVStockWithCustomers = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    // Mirrors getCSVStocks: only real CSV imports (not auto-registration
    // placeholders) and not soft-deleted — narrowed to assigned rows.
    const query: any = {
      creationSource: "csv_import",
      isActive: { $ne: false },
      "stockStatus.status": "Sold",
      "salesInfo.soldTo": { $exists: true },
    };

    const branchFilter = resolveCSVStockBranchFilter(req);
    if (branchFilter) query["stockStatus.branchId"] = branchFilter;

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, "i");
      query.$or = [
        { stockId: searchRegex },
        { modelVariant: searchRegex },
        { engineNumber: searchRegex },
        { frameNumber: searchRegex },
        { "salesInfo.invoiceNumber": searchRegex },
      ];
    }

    const [stocks, total] = await Promise.all([
      StockConceptCSVModel.find(query)
        .populate("stockStatus.branchId", "branchName address")
        .populate("salesInfo.soldTo", "phoneNumber")
        .populate({
          path: "salesInfo.customerVehicleId",
          select:
            "numberPlate registeredOwnerName registrationDate isPaid isFinance insurance",
        })
        .sort({ "salesInfo.soldDate": -1 })
        .skip(skip)
        .limit(limit),
      StockConceptCSVModel.countDocuments(query),
    ]);

    const data = await attachCustomerProfiles(stocks);

    res.status(200).json({
      success: true,
      count: data.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data,
    });
  }
);
