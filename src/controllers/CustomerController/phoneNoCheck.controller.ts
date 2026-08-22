import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { BaseCustomerModel } from "../../models/CustomerSystem/BaseCustomer";
import logger from "../../utils/logger";

/**
 * @desc    Check if phone number exists in database
 * @route   POST /api/customer/check-phone
 * @access  Public
 */
export const checkPhoneNumber = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { phoneNumber } = req.body;

    // Validate input
    if (!phoneNumber) {
      res.status(400);
      throw new Error("Phone number is required");
    }

    // Validate phone number format
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      res.status(400);
      throw new Error("Invalid phone number format");
    }

    try {
      // Check if customer exists with this phone number
      const customer = await BaseCustomerModel.findOne({
        phoneNumber: phoneNumber,
      }).select("phoneNumber isVerified");

      const exists = !!customer;

      // Log the check for monitoring
      logger.info(
        `Phone number check: ${phoneNumber} - ${exists ? "Found" : "Not found"}`
      );

      res.status(200).json({
        success: true,
        exists,
        data: exists
          ? {
              phoneNumber: customer.phoneNumber,
              isVerified: customer.isVerified,
            }
          : null,
        message: exists
          ? "Phone number found in database"
          : "Phone number not found in database",
      });
    } catch (error) {
      logger.error(`Error checking phone number ${phoneNumber}:`, error);
      res.status(500);
      throw new Error("Database error occurred while checking phone number");
    }
  }
);

/**
 * @desc    Batch check multiple phone numbers
 * @route   POST /api/customer/check-phones-batch
 * @access  Public (with rate limiting recommended)
 */
export const checkPhoneNumbersBatch = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { phoneNumbers } = req.body;

    // Validate input
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      res.status(400);
      throw new Error("Phone numbers array is required");
    }

    // Limit batch size to prevent abuse
    if (phoneNumbers.length > 10) {
      res.status(400);
      throw new Error("Maximum 10 phone numbers allowed per batch");
    }

    // Validate all phone number formats
    const phoneRegex = /^[6-9]\d{9}$/;
    const invalidNumbers = phoneNumbers.filter(
      (phone) => !phoneRegex.test(phone)
    );

    if (invalidNumbers.length > 0) {
      res.status(400);
      throw new Error(
        `Invalid phone number format: ${invalidNumbers.join(", ")}`
      );
    }

    try {
      // Check all phone numbers at once
      const customers = await BaseCustomerModel.find({
        phoneNumber: { $in: phoneNumbers },
      }).select("phoneNumber isVerified");

      // Create results map
      const results = phoneNumbers.map((phone) => {
        const customer = customers.find((c) => c.phoneNumber === phone);
        return {
          phoneNumber: phone,
          exists: !!customer,
          isVerified: customer?.isVerified || false,
        };
      });

      logger.info(
        `Batch phone check completed: ${phoneNumbers.length} numbers checked`
      );

      res.status(200).json({
        success: true,
        data: results,
        message: `Checked ${phoneNumbers.length} phone numbers`,
      });
    } catch (error) {
      logger.error(`Error in batch phone number check:`, error);
      res.status(500);
      throw new Error("Database error occurred while checking phone numbers");
    }
  }
);
