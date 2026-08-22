// Debug version of branches.controller.ts

import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import Branch from "../models/Branch";
import logger from "../utils/logger";
import mongoose from "mongoose";

/**
 * Generate a unique branch ID from branch branchName
 */
const generateBranchId = (branchName: string): string => {
  // Remove "Honda Motorcycles" prefix if present and convert to lowercase
  const cleanName = branchName
    .replace(/honda\s*motorcycles?\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // Remove special characters
    .substring(0, 20); // Limit length

  return cleanName || "branch";
};

/**
 * Check if generated ID is unique, if not append number
 */
const ensureUniqueId = async (baseId: string): Promise<string> => {
  let uniqueId = baseId;
  let counter = 1;

  while (await Branch.findOne({ id: uniqueId })) {
    uniqueId = `${baseId}${counter}`;
    counter++;
  }

  return uniqueId;
};

/**
 * @desc    Add a new branch
 * @route   POST /api/branch
 * @access  Private (Super-Admin only)
 */
export const addBranch = asyncHandler(async (req: Request, res: Response) => {
  const { branchName, address, phone, email, hours } = req.body;

  // Debug individual fields
  console.log("Extracted fields:");
  console.log("branchName:", branchName);
  console.log("address:", address);
  console.log("phone:", phone);
  console.log("email:", email);

  // Validate required fields (removed 'id' from required fields)
  if (!branchName || !address || !phone || !email) {
    res.status(400);
    throw new Error(
      "Please provide all required fields: name, address, phone, and email",
    );
  }

  // Validate hours if provided
  if (hours && (!hours.weekdays || !hours.saturday || !hours.sunday)) {
    res.status(400);
    throw new Error("Hours must include weekdays, saturday, and sunday");
  }

  // Set default hours if not provided
  const defaultHours = {
    weekdays: "9:00 AM - 7:00 PM",
    saturday: "10:00 AM - 5:00 PM",
    sunday: "Closed",
  };

  // Generate unique branch ID from branchName
  const baseId = generateBranchId(branchName);
  const uniqueId = await ensureUniqueId(baseId);

  // Create new branch
  const branch = await Branch.create({
    id: uniqueId,
    branchName,
    address,
    phone,
    email,
    hours: hours || defaultHours,
  });

  logger.info(`New branch added: ${branchName} with ID: ${uniqueId}`);

  res.status(201).json({
    success: true,
    data: branch,
    message: "Branch added successfully",
  });
});

/**
 * @desc    Get all branches
 * @route   GET /api/branch
 * @access  Public
 */
export const getBranches = asyncHandler(async (req: Request, res: Response) => {
  const branches = await Branch.find();

  res.status(200).json({
    success: true,
    count: branches.length,
    data: branches,
  });
});

/**
 * @desc    Get branch by ID
 * @route   GET /api/branch/:id
 * @access  Public
 */
export const getBranchById = asyncHandler(
  async (req: Request, res: Response) => {
    const branch = await Branch.findOne({ id: req.params.id });

    if (!branch) {
      res.status(404);
      throw new Error("Branch not found");
    }

    res.status(200).json({
      success: true,
      data: branch,
    });
  },
);

/**
 * @desc    Update branch
 * @route   PUT /api/branch/:id
 * @access  Private (Super-Admin only)
 */
export const updateBranch = asyncHandler(
  async (req: Request, res: Response) => {
    // Debug logging
    console.log("=== updateBranch Debug Info ===");
    console.log("Request method:", req.method);
    console.log("Request params:", req.params);
    console.log("Request body:", req.body);
    console.log("Content-Type:", req.headers["content-type"]);
    console.log("=== End Debug Info ===");

    const { id } = req.params;

    // Check if req.body exists and is not empty
    if (!req.body || Object.keys(req.body).length === 0) {
      res.status(400).json({
        success: false,
        error:
          "Request body is missing or empty. Please send data in JSON format with Content-Type: application/json",
      });
      return;
    }

    const { branchName, address, phone, email, hours } = req.body;

    try {
      // Find branch by custom id or MongoDB _id
      let branch;

      if (mongoose.Types.ObjectId.isValid(id)) {
        // Try finding by MongoDB _id first
        branch = await Branch.findById(id);

        // If not found by _id, try by custom id field
        if (!branch) {
          branch = await Branch.findOne({ id: id });
        }
      } else {
        // Find by custom id field
        branch = await Branch.findOne({ id: id });
      }

      if (!branch) {
        res.status(404).json({
          success: false,
          error: "Branch not found",
        });
        return;
      }

      // Prepare update data (only include fields that are provided)
      const updateData: any = {};
      if (branchName !== undefined) updateData.branchName = branchName;
      if (address !== undefined) updateData.address = address;
      if (phone !== undefined) updateData.phone = phone;
      if (email !== undefined) updateData.email = email;
      if (hours !== undefined) updateData.hours = hours;

      // Update branch using the MongoDB _id
      const updatedBranch = await Branch.findByIdAndUpdate(
        branch._id,
        updateData,
        { new: true, runValidators: true },
      );

      if (!updatedBranch) {
        res.status(404).json({
          success: false,
          error: "Failed to update branch",
        });
        return;
      }

      logger.info(`Branch updated: ${updatedBranch.branchName}`);

      res.status(200).json({
        success: true,
        data: updatedBranch,
        message: "Branch updated successfully",
      });
    } catch (error: any) {
      logger.error(`Error updating branch: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to update branch",
        details: error.message,
      });
    }
  },
);

/**
 * @desc    Delete branch
 * @route   DELETE /api/branch/:id
 * @access  Private (Super-Admin only)
 */
export const deleteBranch = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      let branch;

      // Check if it's a MongoDB ObjectId or custom id
      if (mongoose.Types.ObjectId.isValid(id)) {
        // Try finding by MongoDB _id first
        branch = await Branch.findById(id);

        // If not found by _id, try by custom id field
        if (!branch) {
          branch = await Branch.findOne({ id: id });
        }
      } else {
        // Find by custom id field
        branch = await Branch.findOne({ id: id });
      }

      if (!branch) {
        res.status(404).json({
          success: false,
          error: "Branch not found",
        });
        return;
      }

      // Delete using MongoDB _id
      await Branch.findByIdAndDelete(branch._id);

      logger.info(`Branch deleted: ${branch.branchName}`);

      res.status(200).json({
        success: true,
        message: "Branch deleted successfully",
      });
    } catch (error: any) {
      logger.error(`Error deleting branch: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to delete branch",
      });
    }
  },
);
