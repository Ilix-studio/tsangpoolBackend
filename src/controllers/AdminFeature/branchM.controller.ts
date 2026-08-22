import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import BranchManager from "../../models/BranchManager";
import logger from "../../utils/logger";

/**
 * @desc    Login Branch Manager
 * @route   POST /api/adminLogin/branchM-login
 * @access  Public
 */
export const loginBranchM = asyncHandler(
  async (req: Request, res: Response) => {
    const { phoneNumber, password } = req.body;

    // Validate input
    if (!phoneNumber || !password) {
      res.status(400).json({
        success: false,
        message: "Please provide both application ID and password",
      });
      return;
    }

    // Find branch manager by application ID
    const branchManager = await BranchManager.findOne({ phoneNumber }).select(
      "+password",
    );

    // Check if branch manager exists and password matches
    if (!branchManager || !(await branchManager.matchPassword(password))) {
      logger.info(`Failed login attempt for application ID: ${phoneNumber}`);
      res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
      return;
    }

    // Populate branch details
    await branchManager.populate("branch", "branchName address");

    // Generate token
    const token = branchManager.getSignedJwtToken();

    // Log successful login
    logger.info(`Branch manager logged in: ${branchManager.phoneNumber}`);

    // Return success with token
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: branchManager._id,
        phoneNumber: branchManager.phoneNumber,
        branch: branchManager.branch,
        role: "Branch-Admin",
        token,
      },
    });
  },
);

/**
 * @desc    Logout Branch Manager
 * @route   POST /api/adminLogin/branchM-logout
 * @access  Private
 */
export const logoutBranchM = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  },
);
