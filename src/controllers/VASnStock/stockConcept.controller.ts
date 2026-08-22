import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { StockConceptModel } from "../../models/BikeSystemModel2/StockConcept";
import logger from "../../utils/logger";
import { StockConceptCSVModel } from "../../models/BikeSystemModel3/StockConceptCSV";
import { isBranchManager } from "../../types/user.types";
import { attachCustomerProfiles } from "../../service/attachCustomerProfiles";

export const createStockItem = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      modelName,
      category,
      engineCC,
      engineNumber,
      chassisNumber,
      color,
      variant,
      yearOfManufacture,
      exShowroomPrice,
      roadTax = 0,
      branchId,
      location = "Warehouse",
      uniqueBookRecord,
    } = req.body;

    const resolvedBranchId =
      req.user && isBranchManager(req.user) ? req.user.branch : branchId;

    if (
      !modelName ||
      !category ||
      !engineCC ||
      !engineNumber ||
      !chassisNumber ||
      !color ||
      !variant ||
      !yearOfManufacture ||
      !exShowroomPrice ||
      !resolvedBranchId
    ) {
      res.status(400);
      throw new Error("Please provide all required fields");
    }

    const normalizedEngine = engineNumber.toUpperCase();
    const normalizedChassis = chassisNumber.toUpperCase();

    const [duplicateInManual, duplicateInCSV] = await Promise.all([
      StockConceptModel.findOne({
        $or: [
          { engineNumber: normalizedEngine },
          { chassisNumber: normalizedChassis },
        ],
      })
        .select("_id stockId")
        .lean(),
      StockConceptCSVModel.findOne({
        $or: [
          { engineNumber: normalizedEngine },
          { frameNumber: normalizedChassis },
        ],
      })
        .select("_id stockId")
        .lean(),
    ]);

    if (duplicateInManual || duplicateInCSV) {
      const source = duplicateInManual ? "manual stock" : "CSV stock";
      res.status(409);
      throw new Error(
        `Duplicate entry: engine/chassis number already exists in ${source}`,
      );
    }

    const stockCount = await StockConceptModel.countDocuments();
    const stockId = `STK-${Date.now()}-${String(stockCount + 1).padStart(4, "0")}`;
    const onRoadPrice = exShowroomPrice + roadTax;

    const stockItem = await StockConceptModel.create({
      stockId,
      modelName,
      category,
      engineCC,
      color,
      variant,
      yearOfManufacture,
      uniqueBookRecord,
      engineNumber: normalizedEngine,
      chassisNumber: normalizedChassis,
      stockStatus: {
        status: "Available",
        location,
        branchId: resolvedBranchId,
        lastUpdated: new Date(),
        updatedBy: req.user!._id,
      },
      priceInfo: { exShowroomPrice, roadTax, onRoadPrice },
    });

    await stockItem.populate([
      { path: "stockStatus.branchId", select: "branchName address" },
    ]);

    logger.info(`Stock item created: ${stockItem.stockId} by ${req.user!._id}`);

    res
      .status(201)
      .json({
        success: true,
        message: "Stock item created successfully",
        data: stockItem,
      });
  },
);

export const getAllStockItems = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const filter: any = { isActive: true };

    if (req.user && isBranchManager(req.user)) {
      filter["stockStatus.branchId"] = req.user.branch;
    } else if (req.query.branchId) {
      filter["stockStatus.branchId"] = req.query.branchId;
    }

    if (req.query.status) filter["stockStatus.status"] = req.query.status;
    if (req.query.location) filter["stockStatus.location"] = req.query.location;
    if (req.query.category) filter["category"] = req.query.category;
    if (req.query.fuelType) filter["fuelType"] = req.query.fuelType;

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, "i");
      filter.$or = [
        { stockId: searchRegex },
        { modelName: searchRegex },
        { engineNumber: searchRegex },
        { chassisNumber: searchRegex },
      ];
    }

    const total = await StockConceptModel.countDocuments(filter);
    const stockItems = await StockConceptModel.find(filter)
      .populate("stockStatus.branchId", "branchName address")
      .populate("salesInfo.soldTo", "phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      count: stockItems.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data: stockItems,
    });
  },
);

export const getStockItemById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid stock item ID");
    }

    const stockItem = await StockConceptModel.findById(id).populate(
      "stockStatus.branchId",
      "branchName address phone",
    );

    if (!stockItem) {
      res.status(404);
      throw new Error("Stock item not found");
    }

    res.status(200).json({ success: true, data: stockItem });
  },
);

export const getMyVehicles = asyncHandler(
  async (req: Request, res: Response) => {
    const customerId = req.customer?._id;

    if (!customerId) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    // Regular (catalog) stock sold to this customer.
    const stockVehicles = await StockConceptModel.find({
      "salesInfo.soldTo": customerId,
      "stockStatus.status": "Sold",
      isActive: true,
    })
      .populate("stockStatus.branchId", "branchName address")
      .populate("salesInfo.salesPerson", "name email")
      .populate("salesInfo.customerVehicleId")
      .lean();

    // CSV-imported stock sold to this customer — a separate collection, so
    // it never shows up in the StockConcept query above even though the
    // customer legitimately owns the vehicle (assignCSVStockToCustomer sets
    // salesInfo on StockConceptCSVModel, not StockConceptModel).
    const csvVehicles = await StockConceptCSVModel.find({
      "salesInfo.soldTo": customerId,
      "stockStatus.status": "Sold",
      isActive: true,
    })
      .populate("stockStatus.branchId", "branchName address")
      .populate("salesInfo.customerVehicleId")
      .lean();

    // Normalize CSV stock into the same shape the frontend expects from
    // StockConcept documents.
    const normalizedCsvVehicles = csvVehicles.map((stock) => ({
      _id: stock._id,
      stockId: stock.stockId,
      modelName: stock.modelVariant,
      category: (stock.csvData?.category as string) || "Bike",
      engineCC: Number(stock.csvData?.engineCC) || 0,
      color: stock.color,
      variant: (stock.csvData?.variant as string) || stock.modelVariant,
      yearOfManufacture:
        Number(stock.csvData?.yearOfManufacture) ||
        new Date(stock.csvImportDate).getFullYear(),
      engineNumber: stock.engineNumber,
      chassisNumber: stock.frameNumber,
      stockStatus: stock.stockStatus,
      salesInfo: stock.salesInfo,
      salesHistory: [],
      priceInfo: {
        exShowroomPrice: stock.costPrice || stock.salesInfo?.salePrice || 0,
        roadTax: 0,
        onRoadPrice: stock.salesInfo?.salePrice || stock.costPrice || 0,
      },
      isActive: stock.isActive,
      createdAt: stock.createdAt,
      updatedAt: stock.updatedAt,
    }));

    const withServiceExpenses = (v: any) => ({
      ...v,
      serviceExpenses: v.salesInfo?.customerVehicleId?.serviceExpenses ?? {
        partsRevenue: 0,
        lubesRevenue: 0,
        totalJobCardRevenue: 0,
      },
    });

    const vehicles: any[] = [
      ...stockVehicles.map(withServiceExpenses),
      ...normalizedCsvVehicles.map(withServiceExpenses),
    ].sort(
      (a, b) =>
        new Date(b.salesInfo?.soldDate ?? 0).getTime() -
        new Date(a.salesInfo?.soldDate ?? 0).getTime(),
    );

    res
      .status(200)
      .json({ success: true, count: vehicles.length, data: vehicles });
  },
);

export const getVehicleById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid vehicle ID");
    }

    const vehicle = await StockConceptModel.findById(id)
      .populate("stockStatus.branchId", "branchName address")
      .populate("salesInfo.soldTo", "phoneNumber firstName lastName")
      .populate("salesInfo.salesPerson", "name email")
      .populate("salesInfo.customerVehicleId")
      .populate("salesHistory.soldTo", "phoneNumber firstName lastName")
      .populate("salesHistory.salesPerson", "name email");

    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    if (req.customer) {
      const isOwner =
        vehicle.salesInfo?.soldTo?._id?.toString() ===
        req.customer._id.toString();
      if (!isOwner) {
        res.status(403);
        throw new Error("Access denied: You can only view your own vehicles");
      }
    }

    res.status(200).json({ success: true, data: vehicle });
  },
);

/**
 * @desc    Get all assigned stock with customer info (Admin)
 * @route   GET /api/stock-concept/assigned
 * @access  Private (Super-Admin, Branch-Admin)
 */
export const getAssignedStockWithCustomers = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const filter: any = {
      isActive: true,
      "stockStatus.status": "Sold",
    };

    if (req.user && isBranchManager(req.user)) {
      filter["stockStatus.branchId"] = req.user.branch;
    } else if (req.query.branchId) {
      filter["stockStatus.branchId"] = req.query.branchId;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search as string, "i");
      filter.$or = [
        { stockId: searchRegex },
        { modelName: searchRegex },
        { engineNumber: searchRegex },
        { chassisNumber: searchRegex },
      ];
    }

    const total = await StockConceptModel.countDocuments(filter);

    const stockItems = await StockConceptModel.find(filter)
      .populate("stockStatus.branchId", "branchName address")
      .populate("salesInfo.soldTo", "phoneNumber")
      .populate("salesInfo.salesPerson", "name phoneNumber")
      .populate({
        path: "salesInfo.customerVehicleId",
        select:
          "numberPlate registeredOwnerName registrationDate isPaid isFinance insurance",
      })
      .sort({ "salesInfo.soldDate": -1 })
      .skip(skip)
      .limit(limit);

    const data = await attachCustomerProfiles(stockItems);

    res.status(200).json({
      success: true,
      count: data.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data,
    });
  },
);
