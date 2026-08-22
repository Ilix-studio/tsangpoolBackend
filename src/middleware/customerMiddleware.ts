import { Request, Response, NextFunction } from "express";
import asyncHandler from "express-async-handler";

import ErrorResponse from "../utils/errorResponse";

import admin from "../config/firebaseAdmin";
import {
  BaseCustomerModel,
  IBaseCustomer,
} from "../models/CustomerSystem/BaseCustomer";
import { CustomerProfileModel } from "../models/CustomerSystem/CustomerProfile";

// Extend Request interface to include customer
declare global {
  namespace Express {
    interface Request {
      customer?: IBaseCustomer;
    }
  }
}

/**
 * Protect customer routes - requires customer authentication
 * Uses Firebase token verification
 */
export const protectCustomer = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token;

    if (req.headers.authorization?.startsWith("Bearer")) {
      try {
        token = req.headers.authorization.split(" ")[1];
        console.log("Token received:", token.substring(0, 50) + "...");

        // Verify Firebase token
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log("Token decoded successfully, UID:", decodedToken.uid);

        // Find customer by Firebase UID using BaseCustomer model
        const customer = await BaseCustomerModel.findOne({
          firebaseUid: decodedToken.uid,
        });

        if (!customer) {
          console.log("No customer found with UID:", decodedToken.uid);
          res.status(401);
          throw new Error("Customer not found with this token");
        }

        if (!customer.isVerified) {
          console.log("Customer not verified:", customer.phoneNumber);
          res.status(401);
          throw new Error("Customer account is not verified");
        }

        req.customer = customer;
        next();
      } catch (error: any) {
        console.error("Firebase token verification detailed error:");
        console.error("Error message:", error.message);
        console.error("Error code:", error.code);
        console.error("Full error:", JSON.stringify(error, null, 2));

        res.status(401);
        throw new Error("Not authorized, invalid token");
      }
    } else {
      res.status(401);
      throw new Error("Not authorized, no token provided");
    }
  }
);

/**
 * Optional customer authentication - doesn't throw error if no token
 */
export const optionalCustomerAuth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token;

    if (req.headers.authorization?.startsWith("Bearer")) {
      try {
        token = req.headers.authorization.split(" ")[1];
        const decodedToken = await admin.auth().verifyIdToken(token);

        const customer = await BaseCustomerModel.findOne({
          firebaseUid: decodedToken.uid,
        });

        if (customer && customer.isVerified) {
          req.customer = customer;
        }
      } catch (error) {
        // Silently fail for optional auth
        console.log("Optional auth failed:", error);
      }
    }

    next();
  }
);

/**
 * Combined middleware for admin or customer access
 * Checks both Firebase token (customer) and JWT token (admin)
 */
export const protectAdminOrCustomer = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let firebaseToken;

    if (req.headers.authorization?.startsWith("Bearer")) {
      firebaseToken = req.headers.authorization.split(" ")[1];

      try {
        // First try Firebase token (customer)
        const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
        const customer = await BaseCustomerModel.findOne({
          firebaseUid: decodedToken.uid,
        });

        if (customer && customer.isVerified) {
          req.customer = customer;
          return next();
        }
      } catch (firebaseError) {
        // If Firebase fails, try JWT token (admin)
        try {
         const { verifyToken } = require("../utils/jwt");
    const decoded = verifyToken(firebaseToken);

    const AdminModel = require("../models/Admin").default;
    const BranchManagerModel = require("../models/BranchManager").default;
    const ServiceAdminModel = require("../models/ServiceAdmin").default;
    const StaffModel = require("../models/Staff").default;

       let user =
      (await AdminModel.findById(decoded.id).select("-password")) ||
      (await BranchManagerModel.findById(decoded.id)
        .select("-password")
        .populate("branch", "name address")) ||
      (await ServiceAdminModel.findById(decoded.id).select("-password")) ||
      (await StaffModel.findById(decoded.id).select("-password"));

          if (user) {
            req.user = user;
            return next();
          }
        } catch (jwtError) {
          console.error("JWT verification also failed:", jwtError);
        }
      }
    }

    res.status(401);
    throw new Error("Not authorized, invalid or missing token");
  }
);

/**
 * Check if customer owns the resource
 */
export const ensureCustomerOwnership = (
  customerIdParam: string = "customerId"
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.customer) {
      return next(new ErrorResponse("Customer authentication required", 401));
    }

    const resourceCustomerId = req.params[customerIdParam];

    if (req.customer._id.toString() !== resourceCustomerId) {
      return next(
        new ErrorResponse("Access denied: can only access own data", 403)
      );
    }

    next();
  };
};
/**
 * Verify customer profile completion
 * Now checks the separate CustomerProfile model
 */
export const ensureProfileComplete = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.customer) {
      return next(new ErrorResponse("Customer authentication required", 401));
    }

    const profile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    if (!profile || !profile.profileCompleted) {
      const requiredFields = [
        "firstName",
        "lastName",
        "village",
        "district",
        "state",
      ];

      const missingFields = requiredFields.filter(
        (field) => !profile?.[field as keyof typeof profile]
      );

      res.status(400).json({
        success: false,
        error: "Profile incomplete",
        message: `Please complete your profile. Missing: ${missingFields.join(
          ", "
        )}`,
        missingFields,
      });
      return;
    }

    next();
  }
);
