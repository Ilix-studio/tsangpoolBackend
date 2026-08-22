import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import ValueAddedServiceModel from "../../../models/BikeSystemModel2/VASmodel";
import { CustomerVehicleModel } from "../../../models/BikeSystemModel2/CustomerVehicleModel";
import logger from "../../../utils/logger";

/**
 * @desc    Activate service for customer (Admin action)
 * @route   POST /api/value-added-services/:id/activate
 * @access  Private (Admin)
 */
export const activateCustomerService = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { serviceId, customerId } = req.body; // Get both from body

      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(serviceId)) {
        res.status(400);
        throw new Error("Invalid service ID format");
      }

      // Validate required fields
      if (!customerId) {
        res.status(400);
        throw new Error("Customer ID is required");
      }

      // Validate customer ID format
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        res.status(400);
        throw new Error("Invalid customer ID format");
      }

      // Find service with detailed error information
      const service = await ValueAddedServiceModel.findById(serviceId);

      if (!service) {
        logger.warn(`Service not found with ID: ${serviceId}`);
        res.status(404);
        throw new Error("Service not found");
      }

      if (!service.isActive) {
        logger.warn(
          `Service inactive with ID: ${serviceId}, serviceName: ${service.serviceName}`,
        );
        res.status(400);
        throw new Error("Service is currently inactive");
      }

      // Check service validity period
      const now = new Date();
      if (service.validFrom && service.validFrom > now) {
        res.status(400);
        throw new Error("Service is not yet available");
      }

      if (service.validUntil && service.validUntil < now) {
        res.status(400);
        throw new Error("Service has expired");
      }

      // Find customer's vehicle with better error handling
      const vehicle = await CustomerVehicleModel.findOne({
        customer: customerId,
        isActive: true,
      }).populate("customer", "phoneNumber");

      if (!vehicle) {
        logger.warn(`No active vehicle found for customer: ${customerId}`);
        res.status(404);
        throw new Error("No active vehicle found for this customer");
      }

      // Check if service already active
      const existingService = vehicle.activeValueAddedServices.find(
        (vas) => vas.serviceId.toString() === serviceId && vas.isActive,
      );

      if (existingService) {
        res.status(400);
        throw new Error("Service already active for this vehicle");
      }

      // Activate service
      const activationDate = new Date();
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + service.coverageYears);

      const newVAS = {
        serviceId: new mongoose.Types.ObjectId(serviceId),
        activatedDate: activationDate,
        expiryDate,
        purchasePrice: service.priceStructure.basePrice,
        coverageYears: service.coverageYears,
        isActive: true,
      };

      vehicle.activeValueAddedServices.push(newVAS);
      await vehicle.save();

      logger.info(
        `Service ${service.serviceName} activated for customer ${
          (vehicle.customer as any)?.phoneNumber
        } vehicle ${vehicle.numberPlate}`,
      );

      res.status(200).json({
        success: true,
        message: "Service activated successfully",
        data: {
          serviceId: serviceId,
          serviceName: service.serviceName,
          customer: customerId,
          vehicle: vehicle._id,
          activation: {
            activatedDate: activationDate,
            expiryDate,
            purchasePrice: newVAS.purchasePrice,
          },
        },
      });
    } catch (error) {
      logger.error("VAS Activation Error:", {
        serviceId: req.body.serviceId,
        customerId: req.body.customerId,
      });
      throw error; // Re-throw to be handled by asyncHandler
    }
  },
);
//Hello
/**
 * @desc    Deactivate service for customer (Admin action)
 * @route   PATCH /api/value-added-services/:serviceId/deactivate/:vehicleId
 * @access  Private (Admin)
 */
export const deactivateCustomerService = asyncHandler(
  async (req: Request, res: Response) => {
    const { serviceId, vehicleId } = req.params;
    const { reason } = req.body;

    const vehicle = await CustomerVehicleModel.findById(vehicleId).populate(
      "customer",
      "phoneNumber",
    );

    if (!vehicle) {
      res.status(404);
      throw new Error("Vehicle not found");
    }

    const serviceIndex = vehicle.activeValueAddedServices.findIndex(
      (vas) => vas.serviceId.toString() === serviceId && vas.isActive,
    );

    if (serviceIndex === -1) {
      res.status(404);
      throw new Error("Active service not found for this vehicle");
    }

    // Deactivate the service
    vehicle.activeValueAddedServices[serviceIndex].isActive = false;
    await vehicle.save();

    const service = await ValueAddedServiceModel.findById(serviceId);

    logger.info(
      `Service ${service?.serviceName} deactivated for customer ${
        (vehicle.customer as any)?.phoneNumber
      } vehicle ${vehicle.numberPlate}. Reason: ${reason || "Not specified"}`,
    );

    res.status(200).json({
      success: true,
      message: "Service deactivated successfully",
      data: {
        serviceId,
        serviceName: service?.serviceName,
        vehicle: vehicle.numberPlate,
        customerPhone: (vehicle.customer as any)?.phoneNumber,
        deactivatedAt: new Date(),
        reason: reason || "Not specified",
      },
    });
  },
);
