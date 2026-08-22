import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { StockConceptModel } from "../../../models/BikeSystemModel2/StockConcept";
import { StockConceptCSVModel } from "../../../models/BikeSystemModel3/StockConceptCSV";
import { BaseCustomerModel } from "../../../models/CustomerSystem/BaseCustomer";
import { CustomerVehicleModel } from "../../../models/BikeSystemModel2/CustomerVehicleModel";
import logger from "../../../utils/logger";
import { resolveBranchScope } from "../../../service/rag/scope";

/**
 * @desc    Assign stock item to customer
 * @route   PATCH /api/stock-concept/:id/assign
 * @access  Private (Super-Admin, Branch-Admin)
 */
export const activateToCustomer = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
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
      rtoName, // Added parameter for RTO info
      rtoAddress, // Added parameter for RTO info
      state = "AS", // Default state
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid stock item ID");
    }

    // Validate required fields
    if (!customerId || !salePrice || !invoiceNumber) {
      res.status(400);
      throw new Error(
        "Please provide customer ID, sale price, and invoice number"
      );
    }

    // Check stock item exists and is available
    const stockItem = await StockConceptModel.findById(id);
    if (!stockItem) {
      res.status(404);
      throw new Error("Stock item not found");
    }

    if (stockItem.stockStatus.status !== "Available") {
      res.status(400);
      throw new Error("Stock item is not available for sale");
    }

    // Validate customer exists by ID
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      res.status(400);
      throw new Error("Invalid customer ID");
    }

    const customer = await BaseCustomerModel.findById(customerId);
    if (!customer) {
      res.status(404);
      throw new Error("Customer not found");
    }

    // Create RTO info object if numberPlate is provided
    let rtoInfo;
    if (numberPlate) {
      const rtoCode = numberPlate.substring(0, 4).toUpperCase();
      rtoInfo = {
        rtoCode,
        rtoName: rtoName || `RTO ${rtoCode}`, // Use provided name or generate one
        rtoAddress: rtoAddress || `RTO Office, ${state}`, // Use provided address or generate one
        state: state,
      };
    }

    // Create customer vehicle record
    const customerVehicle = await CustomerVehicleModel.create({
      stockConcept: stockItem._id,
      stockType: "StockConcept",
      modelName: stockItem.modelName,
      registrationDate: registrationDate
        ? new Date(registrationDate)
        : undefined,
      numberPlate: numberPlate?.toUpperCase(),
      insurance,
      isPaid,
      isFinance,
      color: stockItem.color,
      customer: customer._id, // Changed from customerPhoneNumber: customer._id
      registeredOwnerName: registeredOwnerName || undefined,
      rtoInfo: rtoInfo,
    });

    // Save previous owner to sales history if this is a resale
    if (stockItem.salesInfo && stockItem.salesInfo.soldTo) {
      stockItem.salesHistory.push({
        soldTo: stockItem.salesInfo.soldTo,
        soldDate: stockItem.salesInfo.soldDate || new Date(),
        salePrice: stockItem.salesInfo.salePrice || 0,
        salesPerson: stockItem.salesInfo.salesPerson!,
        invoiceNumber: stockItem.salesInfo.invoiceNumber || "",
        paymentStatus: stockItem.salesInfo.paymentStatus || "Pending",
        customerVehicleId: stockItem.salesInfo.customerVehicleId!,
        transferType: "Ownership Transfer",
      });
    }

    // Update stock item with sales information
    stockItem.salesInfo = {
      soldTo: new mongoose.Types.ObjectId(customer._id),
      soldDate: new Date(),
      salePrice,
      invoiceNumber,
      paymentStatus,
      customerVehicleId: new mongoose.Types.ObjectId(customerVehicle._id),
    };

    stockItem.stockStatus.status = "Sold";
    stockItem.stockStatus.location = "Customer";
    stockItem.stockStatus.lastUpdated = new Date();

    await stockItem.save();

    await stockItem.populate([
      { path: "salesInfo.soldTo", select: "phoneNumber" },
      { path: "stockStatus.branchId", select: "branchName" },
    ]);

    // Safely access req.user._id with optional chaining
    const userId = req.user?._id || "system";

    logger.info(
      `Stock item ${stockItem.stockId} assigned to customer ${customer.phoneNumber} by ${userId}`
    );

    res.status(200).json({
      success: true,
      message: "Stock item successfully assigned to customer",
      data: {
        stockItem,
        customerVehicle: {
          _id: customerVehicle._id,
          numberPlate: customerVehicle.numberPlate,
        },
      },
    });
  }
);

/**
 * @desc    CSV stock-assignment KPIs + monthly breakdown
 * @route   GET /api/csv-stock/assign-stats
 * @access  Private (Super-Admin, Branch-Admin)
 */
export const getCSVStockAssignStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const year = Number(req.query.year) || new Date().getFullYear();
    const scope = resolveBranchScope(req.user, req.query.branchId as string);

    if (scope === null) {
      res.status(400);
      throw new Error("Branch could not be resolved");
    }

    const baseMatch: Record<string, any> = {
      // $ne (not exact equality) so legacy StockConceptCSV documents written
      // before the `creationSource` field existed — which have no stored
      // value at all, since Mongoose schema defaults never apply inside
      // .aggregate() — are still included. "automatic_creation" is the only
      // value this should ever exclude.
      creationSource: { $ne: "automatic_creation" },
      "salesInfo.soldDate": { $exists: true },
    };
    if (scope !== "all") {
      baseMatch["stockStatus.branchId"] = scope;
    }

    const yearMatch = {
      ...baseMatch,
      "salesInfo.soldDate": {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    };

    const [monthly, totals] = await Promise.all([
      StockConceptCSVModel.aggregate([
        { $match: yearMatch },
        {
          $group: {
            _id: { month: { $month: "$salesInfo.soldDate" } },
            assignedCount: { $sum: 1 },
          },
        },
        { $sort: { "_id.month": 1 } },
      ]),
      StockConceptCSVModel.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: null,
            totalAssigned: { $sum: 1 },
            totalRevenue: { $sum: "$salesInfo.salePrice" },
          },
        },
      ]),
    ]);

    const monthlyFilled = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].map((month, i) => {
      const found = monthly.find((m) => m._id.month === i + 1);
      return {
        month,
        assignedCount: found?.assignedCount ?? 0,
      };
    });

    const t = totals[0] ?? { totalAssigned: 0, totalRevenue: 0 };

    res.status(200).json({
      success: true,
      data: {
        year,
        totals: {
          totalAssigned: t.totalAssigned,
          totalRevenue: t.totalRevenue,
        },
        monthly: monthlyFilled,
      },
    });
  },
);
