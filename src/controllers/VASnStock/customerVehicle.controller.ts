import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import logger from "../../utils/logger";
// Fixed import
import { BaseCustomerModel } from "../../models/CustomerSystem/BaseCustomer";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";

/**
 * `CustomerVehicle.stockConcept` is a polymorphic `refPath: "stockType"` ref —
 * it resolves to either a `StockConcept` (manually created) or a
 * `StockConceptCSV` (CSV-imported) doc, and the two use different field names
 * for the same ideas. A projection listing only StockConcept's fields silently
 * returns a near-empty doc for CSV stock (that is why CSV-assigned vehicles
 * used to render as "Unknown Model"), so both vocabularies must be selected:
 *   modelName/variant/category/yearOfManufacture → StockConcept only
 *   modelVariant                                 → StockConceptCSV only
 *   chassisNumber ↔ frameNumber                  → same idea, different names
 */
const STOCK_CONCEPT_SELECT =
  "stockId modelName category engineCC color variant yearOfManufacture " +
  "engineNumber chassisNumber priceInfo " +
  "modelVariant frameNumber costPrice stockStatus";


/**
 * @desc    Get all customer vehicles (Admin)
 * @route   GET /api/customer-vehicles
 * @access  Private (Admin)
 */
export const getAllCustomerVehicles = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Build filter based on CustomerVehicle model structure
    const filter: any = { isActive: true };
    if (req.query.serviceType) {
      filter["serviceStatus.serviceType"] = req.query.serviceType;
    }

    const vehicles = await CustomerVehicleModel.find(filter)
      .populate("customer", "phoneNumber")
      .populate("servicePackage.packageId")
      .populate("activeValueAddedServices.serviceId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CustomerVehicleModel.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: vehicles.length,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      data: vehicles,
    });
  }
);

/**
 * @desc    Get customer's own vehicles
 * @route   GET /api/customer-vehicles/my-vehicles
 * @access  Private (Customer)
 */
export const getMyVehicles = asyncHandler(
  async (req: Request, res: Response) => {
    console.log("🚗 getMyVehicles from customerVehicle.controller called");
    console.log("Customer ID:", req.customer?._id);

    const customerPhone = req.customer?.phoneNumber;

    // Query CustomerVehicle directly, not StockConcept
    const vehicles = await CustomerVehicleModel.find({
      customer: req.customer?._id, // Use customer ObjectId instead of phone
      isActive: true,
    })
      .populate({
        path: "stockConcept",
        select: STOCK_CONCEPT_SELECT,
      })
      .sort({ createdAt: -1 });

    console.log("Found vehicles:", vehicles.length);

    res.status(200).json({
      success: true,
      count: vehicles.length,
      data: vehicles,
    });
  }
);

/**
 * @desc    Get vehicle by ID
 * @route   GET /api/customer-vehicles/:id
 * @access  Private (Customer/Admin)
 */
export const getVehicleById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid vehicle ID");
    }

    const vehicle = await CustomerVehicleModel.findById(id)
      .populate("customer", "phoneNumber")
      .populate({
        path: "stockConcept",
        select: STOCK_CONCEPT_SELECT,
      })
      .populate({
        path: "activeValueAddedServices.serviceId",
        select: "serviceName coverageYears priceStructure benefits isActive",
      });

    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    // Check if customer is accessing their own vehicle
    if (
      req.customer &&
      vehicle.customer._id.toString() !== req.customer._id.toString()
    ) {
      res.status(403);
      throw new Error("Access denied");
    }

    res.status(200).json({
      success: true,
      data: vehicle,
    });
  }
);

/**
 * @desc    Create new vehicle from stock
 * @route   POST /api/customer-vehicles/create-from-stock
 * @access  Private (Admin)
 */
export const createVehicleFromStock = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      customerPhoneNumber,
      registrationDate,
      insurance,
      isPaid,
      isFinance,
      color,
      purchaseDate,
      numberPlate,
      registeredOwnerName,
      motorcyclePhoto,
      rtoInfo,
      servicePackageId,
    } = req.body;

    // Validate customer exists
    const customerExists = await BaseCustomerModel.findById(
      customerPhoneNumber
    );
    if (!customerExists) {
      res.status(404);
      throw new Error("Customer not found");
    }

    // Check for duplicates using numberPlate if provided
    if (numberPlate) {
      const existingVehicle = await CustomerVehicleModel.findOne({
        numberPlate: numberPlate.toUpperCase(),
      });

      if (existingVehicle) {
        res.status(400);
        throw new Error("Vehicle with this number plate already exists");
      }
    }

    const vehicle = await CustomerVehicleModel.create({
      registrationDate,
      insurance,
      isPaid,
      isFinance,
      color,
      purchaseDate,
      customerPhoneNumber,
      numberPlate: numberPlate?.toUpperCase(),
      registeredOwnerName,
      motorcyclePhoto,
      rtoInfo: rtoInfo
        ? {
            rtoCode: rtoInfo.rtoCode?.toUpperCase(),
            rtoName: rtoInfo.rtoName,
            rtoAddress: rtoInfo.rtoAddress,
            state: rtoInfo.state?.toUpperCase(),
          }
        : undefined,
      servicePackage: {
        packageId: new mongoose.Types.ObjectId(servicePackageId),
        currentServiceLevel: 1,
        nextServiceType: "firstService",
        completedServices: [],
      },
      serviceStatus: {
        kilometers: 0,
        serviceHistory: 0,
      },
      activeValueAddedServices: [],
      isActive: true,
    });

    await vehicle.populate([
      { path: "customer", select: "phoneNumber" },
      { path: "servicePackage.packageId" },
    ]);

    logger.info(`Vehicle created for customer ${customerExists.phoneNumber}`);

    res.status(201).json({
      success: true,
      message: "Vehicle created successfully",
      data: vehicle,
    });
  }
);

/**
 * @desc    Update vehicle
 * @route   PUT /api/customer-vehicles/:id
 * @access  Private (Admin)
 */
export const updateVehicle = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid vehicle ID");
    }

    const vehicle = await CustomerVehicleModel.findById(id);
    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    // Check for duplicates if updating numberPlate
    const { numberPlate, rtoInfo, ...otherUpdates } = req.body;

    if (numberPlate && numberPlate !== vehicle.numberPlate) {
      const duplicate = await CustomerVehicleModel.findOne({
        _id: { $ne: id },
        numberPlate: numberPlate.toUpperCase(),
      });

      if (duplicate) {
        res.status(400);
        throw new Error(
          "Another vehicle with this number plate already exists"
        );
      }
    }

    // Prepare update data
    const updateData: any = { ...otherUpdates };
    if (numberPlate) updateData.numberPlate = numberPlate.toUpperCase();
    if (rtoInfo) {
      updateData.rtoInfo = {
        rtoCode: rtoInfo.rtoCode?.toUpperCase(),
        rtoName: rtoInfo.rtoName,
        rtoAddress: rtoInfo.rtoAddress,
        state: rtoInfo.state?.toUpperCase(),
      };
    }

    const updatedVehicle = await CustomerVehicleModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate("customer", "phoneNumber");

    logger.info(`Vehicle updated by admin`);

    res.status(200).json({
      success: true,
      message: "Vehicle updated successfully",
      data: updatedVehicle,
    });
  }
);

/**
 * @desc    Delete vehicle
 * @route   DELETE /api/customer-vehicles/:id
 * @access  Private (Admin)
 */
export const deleteVehicle = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid vehicle ID");
    }

    const vehicle = await CustomerVehicleModel.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    logger.info(`Vehicle soft deleted`);

    res.status(200).json({
      success: true,
      message: "Vehicle deleted successfully",
    });
  }
);

/**
 * @desc    Update vehicle service status
 * @route   PUT /api/customer-vehicles/:id/service-status
 * @access  Private (Admin)
 */
export const updateServiceStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid vehicle ID");
    }

    const vehicle = await CustomerVehicleModel.findById(id);
    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    await vehicle.save();

    const updatedVehicle = await CustomerVehicleModel.findById(id).populate(
      "customer",
      "phoneNumber"
    );

    res.status(200).json({
      success: true,
      message: "Service status updated successfully",
      data: updatedVehicle,
    });
  }
);

/**
 * @desc    Get vehicles requiring service
 * @route   GET /api/customer-vehicles/service-due
 * @access  Private (Admin)
 */
export const getServiceDueVehicles = asyncHandler(
  async (req: Request, res: Response) => {
    const currentDate = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(currentDate.getDate() + 7);

    const vehicles = await CustomerVehicleModel.find({
      isActive: true,
      $or: [
        { "serviceStatus.nextServiceDue": { $lte: currentDate } },
        { "serviceStatus.serviceType": "Overdue" },
        {
          "serviceStatus.nextServiceDue": {
            $gte: currentDate,
            $lte: nextWeek,
          },
        },
      ],
    })
      .populate("customer", "phoneNumber")
      .sort({ "serviceStatus.nextServiceDue": 1 });

    res.status(200).json({
      success: true,
      count: vehicles.length,
      data: vehicles,
    });
  }
);

/**
 * @desc    Get vehicle statistics
 * @route   GET /api/customer-vehicles/stats
 * @access  Private (Admin)
 */
export const getVehicleStats = asyncHandler(
  async (req: Request, res: Response) => {
    const totalVehicles = await CustomerVehicleModel.countDocuments({
      isActive: true,
    });

    const serviceStats = await CustomerVehicleModel.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$serviceStatus.serviceType", count: { $sum: 1 } } },
    ]);

    const insuranceStats = await CustomerVehicleModel.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$insurance", count: { $sum: 1 } } },
    ]);

    const paymentStats = await CustomerVehicleModel.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: { isPaid: "$isPaid", isFinance: "$isFinance" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalVehicles,
        serviceStats: serviceStats.reduce(
          (acc: Record<string, number>, curr) => ({
            ...acc,
            [curr._id]: curr.count,
          }),
          {}
        ),
        insuranceStats: insuranceStats.reduce(
          (acc: Record<string, number>, curr) => ({
            ...acc,
            [curr._id ? "insured" : "notInsured"]: curr.count,
          }),
          {}
        ),
        paymentStats: paymentStats.reduce(
          (acc: Record<string, number>, curr) => ({
            ...acc,
            [`paid_${curr._id.isPaid}_finance_${curr._id.isFinance}`]:
              curr.count,
          }),
          {}
        ),
      },
    });
  }
);

/**
 * @desc    Transfer vehicle ownership
 * @route   PUT /api/customer-vehicles/:id/transfer
 * @access  Private (Admin)
 */
export const transferVehicle = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { newCustomerId, newOwnerName } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(id) ||
      !mongoose.Types.ObjectId.isValid(newCustomerId)
    ) {
      res.status(400);
      throw new Error("Invalid vehicle or customer ID");
    }

    const newCustomer = await BaseCustomerModel.findById(newCustomerId);
    if (!newCustomer) {
      res.status(404);
      throw new Error("New customer not found");
    }

    const vehicle = await CustomerVehicleModel.findByIdAndUpdate(
      id,
      {
        customer: newCustomerId,
        registeredOwnerName: newOwnerName || undefined,
      },
      { new: true }
    ).populate("customer", "phoneNumber");

    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    logger.info(`Vehicle transferred to ${newCustomer.phoneNumber}`);

    res.status(200).json({
      success: true,
      message: "Vehicle ownership transferred successfully",
      data: vehicle,
    });
  }
);
/**
 * @desc    Get vehicles associated with a customer phone number
 * @route   GET /api/customer-vehicles/by-phone/:phone
 * @access  Private (Super-Admin, Branch-Admin)
 */
export const getVehiclesByPhone = asyncHandler(
  async (req: Request, res: Response) => {
    const { phone } = req.params;

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      res.status(400);
      throw new Error("Invalid phone number format");
    }

    const customer = await BaseCustomerModel.findOne({
      phoneNumber: phone,
    }).select("_id phoneNumber isVerified");

    if (!customer) {
      res.status(200).json({
        success: true,
        customerFound: false,
        count: 0,
        data: [],
        message: "No customer found with this phone number",
      });
      return;
    }

    const vehicles = await CustomerVehicleModel.find({
      customer: customer._id,
      isActive: true,
    })
      .populate({
        path: "stockConcept",
        select: STOCK_CONCEPT_SELECT,
      })
      .populate({
        path: "activeValueAddedServices.serviceId",
        select: "serviceName serviceType",
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      customerFound: true,
      customer: {
        _id: customer._id,
        phoneNumber: customer.phoneNumber,
        isVerified: customer.isVerified,
      },
      count: vehicles.length,
      data: vehicles,
    });
  }
);
