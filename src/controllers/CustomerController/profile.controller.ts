import {
  CustomerProfileModel,
  ICustomerProfile,
} from "../../models/CustomerSystem/CustomerProfile";
import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { BaseCustomerModel } from "../../models/CustomerSystem/BaseCustomer";

/**
 * @desc    Create customer profile
 * @route   POST /api/customer/profile
 * @access  Private (Customer)
 */
export const createProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      firstName,
      middleName,
      lastName,
      email,
      village,
      postOffice,
      policeStation,
      district,
      state,
      bloodGroup,
      familyNumber1,
      familyNumber2,
    } = req.body;

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    // Check if profile already exists
    const existingProfile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    if (existingProfile) {
      res.status(400);
      throw new Error("Profile already exists. Use update endpoint instead.");
    }

    // Create new profile
    const profile = await CustomerProfileModel.create({
      customer: req.customer._id,
      firstName,
      middleName,
      lastName,
      email,
      village,
      postOffice,
      policeStation,
      district,
      state,
      bloodGroup,
      familyNumber1,
      familyNumber2,
      profileCompleted: true,
    });

    logger.info(`Profile created for customer: ${req.customer.phoneNumber}`);

    res.status(201).json({
      success: true,
      message: "Profile created successfully",
      data: {
        customer: req.customer,
        profile,
      },
    });
  },
);

/**
 * @desc    Get customer profile with base data
 * @route   GET /api/customer/profile
 * @access  Private (Customer)
 */
export const getCustomerProfile = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    // Get profile if exists
    const profile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    const responseData = {
      ...req.customer.toObject(),
      profile: profile || null,
      profileCompleted: !!profile?.profileCompleted,
    };

    res.status(200).json({
      success: true,
      data: responseData,
    });
  },
);

/**
 * @desc    Update customer profile
 * @route   PUT /api/customer/profile
 * @access  Private (Customer)
 */
export const updateCustomerProfile = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const allowedUpdates = [
      "firstName",
      "middleName",
      "lastName",
      "email",
      "village",
      "postOffice",
      "policeStation",
      "district",
      "state",
      "bloodGroup",
      "familyNumber1",
      "familyNumber2",
    ];

    const updates: Partial<ICustomerProfile> = {};
    Object.keys(req.body)
      .filter((key) => allowedUpdates.includes(key))
      .forEach((key) => {
        (updates as any)[key] = req.body[key];
      });

    let profile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    if (!profile) {
      // Create profile if it doesn't exist
      profile = await CustomerProfileModel.create({
        customer: req.customer._id,
        ...updates,
        profileCompleted: true,
      });
    } else {
      // Update existing profile
      Object.assign(profile, updates);
      profile.profileCompleted = true;
      await profile.save();
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { profile },
    });
  },
);

/**
 * @desc    Get all customers with profiles
 * @route   GET /api/customers
 * @access  Private (Admin)
 */
export const getAllCustomers = asyncHandler(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Build filter for base customers
    const filter: any = {};
    if (req.query.isVerified !== undefined) {
      filter.isVerified = req.query.isVerified === "true";
    }

    const customers = await BaseCustomerModel.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Get profiles for these customers
    const customerIds = customers.map((c) => c._id);
    const profiles = await CustomerProfileModel.find({
      customer: { $in: customerIds },
    });

    // Combine data
    const customersWithProfiles = customers.map((customer) => {
      const profile = profiles.find(
        (p) => p.customer.toString() === customer._id.toString(),
      );
      return {
        ...customer.toObject(),
        profile: profile || null,
        profileCompleted: !!profile?.profileCompleted,
      };
    });

    const total = await BaseCustomerModel.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: customersWithProfiles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  },
);

/**
 * @desc    Get customer by ID with profile
 * @route   GET /api/customers/:id
 * @access  Private (Admin/Customer)
 */
export const getCustomerById = asyncHandler(
  async (req: Request, res: Response) => {
    const customer = await BaseCustomerModel.findById(
      req.params.id || req.params.customerId,
    );

    if (!customer) {
      res.status(404);
      throw new Error("Customer not found");
    }

    const profile = await CustomerProfileModel.findOne({
      customer: customer._id,
    });

    const responseData = {
      ...customer.toObject(),
      profile: profile || null,
      profileCompleted: !!profile?.profileCompleted,
    };

    res.status(200).json({
      success: true,
      data: responseData,
    });
  },
);
