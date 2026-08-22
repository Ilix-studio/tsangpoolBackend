import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import BranchManager from "../../models/BranchManager";
import ServiceAdmin from "../../models/ServiceAdmin";
import PartAdmin from "../../models/PartAdmin";
import Developer from "../../models/Developer";
import Staff from "../../models/Staff";
import Branch from "../../models/Branch";
import logger from "../../utils/logger";
import { generateRandomPassword } from "../../utils/generateID";
import { sendWelcomeEmail } from "../../utils/emailService";
import {
  getUserBranch,
  isAdmin,
  isBranchManager,
} from "../../types/user.types";
import { findAccountByPhone } from "../../utils/roleModels";

// ─── Validation Helpers ──────────────────────────────────────────────────────

const validateBranchExists = async (branchId: string) => {
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    throw Object.assign(new Error("Invalid branch ID"), { statusCode: 400 });
  }
  const branch = await Branch.findById(branchId);
  if (!branch) {
    throw Object.assign(new Error("Branch not found"), { statusCode: 404 });
  }
  return branch;
};

const validateRequiredFields = (
  fields: Record<string, unknown>,
  required: string[],
) => {
  const missing = required.filter((f) => !fields[f]);
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`Missing required fields: ${missing.join(", ")}`),
      { statusCode: 400 },
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH-ADMIN MANAGEMENT (Super-Admin only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Create Branch-Admin
 * @route   POST /api/admin/users/branch-admin
 * @access  Super-Admin
 */
export const createBranchAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, email, phoneNumber, address, branch } = req.body;

    validateRequiredFields(req.body, [
      "name",
      "email",
      "phoneNumber",
      "address",
      "branch",
    ]);

    if (!req.user || !isAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Super-Admin can create Branch-Admins");
    }

    const branchDoc = await validateBranchExists(branch);

    // Check duplicate email
    const existing = await BranchManager.findOne({
      email: email.toLowerCase(),
    });
    if (existing) {
      res.status(409);
      throw new Error("A Branch-Admin with this email already exists");
    }

    if (await findAccountByPhone(phoneNumber)) {
      res.status(409);
      throw new Error("This phone number is already registered to another account");
    }

    const password = generateRandomPassword();

    const branchAdmin = await BranchManager.create({
      name,
      email,
      phoneNumber,
      address,
      password,
      branch,
      createdBy: req.user._id,
    });

    // Send welcome email (fire-and-forget — don't block response)
    sendWelcomeEmail({
      to: email,
      name,
      phoneNumber,
      password,
      role: "Branch-Admin",
      branchName: branchDoc.branchName,
    }).catch((err) =>
      logger.error("Welcome email failed for Branch-Admin:", err),
    );

    logger.info(
      `Branch-Admin created: ${branchAdmin._id} for branch ${branchDoc.branchName}`,
    );

    res.status(201).json({
      success: true,
      message: "Branch-Admin created successfully. Credentials sent via email.",
      data: {
        id: branchAdmin._id,
        name: branchAdmin.name,
        email: branchAdmin.email,
        phoneNumber: branchAdmin.phoneNumber,
        password, // returned once at creation
        branch: branchDoc.branchName,
      },
    });
  },
);

/**
 * @desc    Get all Branch-Admins
 * @route   GET /api/admin/users/branch-admins
 * @access  Super-Admin
 */
export const getAllBranchAdmins = asyncHandler(
  async (req: Request, res: Response) => {
    const branchAdmins = await BranchManager.find()
      .select("-password")
      .populate("branch", "branchName address")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: branchAdmins.length,
      data: branchAdmins,
    });
  },
);

/**
 * @desc    Delete Branch-Admin
 * @route   DELETE /api/admin/users/branch-admin/:id
 * @access  Super-Admin
 */
export const deleteBranchAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid Branch-Admin ID");
    }

    const bm = await BranchManager.findById(id);
    if (!bm) {
      res.status(404);
      throw new Error("Branch-Admin not found");
    }

    await BranchManager.findByIdAndDelete(id);
    logger.info(`Branch-Admin deleted: ${bm.phoneNumber}`);

    res.status(200).json({
      success: true,
      message: "Branch-Admin deleted successfully",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE-ADMIN MANAGEMENT
// Super-Admin: any branch (branch passed in body).
// Branch-Admin: their own branch only (branch forced, body branch ignored).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Create Service-Admin
 * @route   POST /api/users/service-admin
 * @access  Super-Admin (any branch), Branch-Admin (own branch)
 */
export const createServiceAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, email, phoneNumber, address, branch } = req.body;

    if (!req.user || (!isAdmin(req.user) && !isBranchManager(req.user))) {
      res.status(403);
      throw new Error(
        "Only Super-Admin or Branch-Admin can create Service-Admins",
      );
    }

    // Resolve the target branch: Branch-Admin is locked to their own branch;
    // Super-Admin must specify one in the body.
    let branchId: string;
    if (isBranchManager(req.user)) {
      const ownBranch = getUserBranch(req.user);
      if (!ownBranch) {
        res.status(400);
        throw new Error("Branch-Admin must be assigned to a branch");
      }
      branchId = ownBranch.toString();
      validateRequiredFields(req.body, [
        "name",
        "email",
        "phoneNumber",
        "address",
      ]);
    } else {
      branchId = branch;
      validateRequiredFields(req.body, [
        "name",
        "email",
        "phoneNumber",
        "address",
        "branch",
      ]);
    }

    const branchDoc = await validateBranchExists(branchId);

    const existing = await ServiceAdmin.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409);
      throw new Error("A Service-Admin with this email already exists");
    }

    if (await findAccountByPhone(phoneNumber)) {
      res.status(409);
      throw new Error("This phone number is already registered to another account");
    }

    const password = generateRandomPassword();

    const serviceAdmin = await ServiceAdmin.create({
      name,
      email,
      phoneNumber,
      address,

      password,
      branch: branchId,
      createdBy: req.user._id,
    });

    sendWelcomeEmail({
      to: email,
      name,
      phoneNumber,
      password,
      role: "Service-Admin",
      branchName: branchDoc.branchName,
    }).catch((err) =>
      logger.error("Welcome email failed for Service-Admin:", err),
    );

    logger.info(
      `Service-Admin created: ${serviceAdmin._id} for branch ${branchDoc.branchName}`,
    );

    res.status(201).json({
      success: true,
      message:
        "Service-Admin created successfully. Credentials sent via email.",
      data: {
        id: serviceAdmin._id,
        name: serviceAdmin.name,
        email: serviceAdmin.email,
        phoneNumber: serviceAdmin.phoneNumber,
        password,
        branch: branchDoc.branchName,
      },
    });
  },
);

/**
 * @desc    Get all Service-Admins
 * @route   GET /api/users/service-admins
 * @access  Super-Admin (all, optional ?branch=), Branch-Admin (own branch)
 */
export const getAllServiceAdmins = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const filter: Record<string, unknown> = {};

    // Branch-Admin only sees Service-Admins from their own branch
    if (isBranchManager(req.user)) {
      filter.branch = getUserBranch(req.user);
    }

    // Super-Admin can optionally filter by branch via query param
    if (isAdmin(req.user) && req.query.branch) {
      filter.branch = req.query.branch;
    }

    const serviceAdmins = await ServiceAdmin.find(filter)
      .select("-password")
      .populate("branch", "branchName address")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: serviceAdmins.length,
      data: serviceAdmins,
    });
  },
);

/**
 * @desc    Delete Service-Admin
 * @route   DELETE /api/users/service-admin/:id
 * @access  Super-Admin, Branch-Admin (own branch only)
 */
export const deleteServiceAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid Service-Admin ID");
    }

    const sa = await ServiceAdmin.findById(id);
    if (!sa) {
      res.status(404);
      throw new Error("Service-Admin not found");
    }

    // Branch-Admin can only delete Service-Admins from their own branch
    if (req.user && isBranchManager(req.user)) {
      const branchId = getUserBranch(req.user);
      if (sa.branch.toString() !== branchId?.toString()) {
        res.status(403);
        throw new Error(
          "You can only delete Service-Admins from your own branch",
        );
      }
    }

    await ServiceAdmin.findByIdAndDelete(id);
    logger.info(`Service-Admin deleted: ${sa.phoneNumber}`);

    res.status(200).json({
      success: true,
      message: "Service-Admin deleted successfully",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PART-ADMIN MANAGEMENT
// Super-Admin: any branch (branch passed in body).
// Branch-Admin: their own branch only (branch forced, body branch ignored).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Create Part-Admin
 * @route   POST /api/users/part-admin
 * @access  Super-Admin (any branch), Branch-Admin (own branch)
 */
export const createPartAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, email, phoneNumber, address, branch } = req.body;

    if (!req.user || (!isAdmin(req.user) && !isBranchManager(req.user))) {
      res.status(403);
      throw new Error(
        "Only Super-Admin or Branch-Admin can create Part-Admins",
      );
    }

    // Resolve the target branch: Branch-Admin is locked to their own branch;
    // Super-Admin must specify one in the body.
    let branchId: string;
    if (isBranchManager(req.user)) {
      const ownBranch = getUserBranch(req.user);
      if (!ownBranch) {
        res.status(400);
        throw new Error("Branch-Admin must be assigned to a branch");
      }
      branchId = ownBranch.toString();
      validateRequiredFields(req.body, [
        "name",
        "email",
        "phoneNumber",
        "address",
      ]);
    } else {
      branchId = branch;
      validateRequiredFields(req.body, [
        "name",
        "email",
        "phoneNumber",
        "address",
        "branch",
      ]);
    }

    const branchDoc = await validateBranchExists(branchId);

    const existing = await PartAdmin.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409);
      throw new Error("A Part-Admin with this email already exists");
    }

    if (await findAccountByPhone(phoneNumber)) {
      res.status(409);
      throw new Error("This phone number is already registered to another account");
    }

    const password = generateRandomPassword();

    const partAdmin = await PartAdmin.create({
      name,
      email,
      phoneNumber,
      address,
      password,
      branch: branchId,
      createdBy: req.user._id,
    });

    sendWelcomeEmail({
      to: email,
      name,
      phoneNumber,
      password,
      role: "Part-Admin",
      branchName: branchDoc.branchName,
    }).catch((err) => logger.error("Welcome email failed for Part-Admin:", err));

    logger.info(
      `Part-Admin created: ${partAdmin._id} for branch ${branchDoc.branchName}`,
    );

    res.status(201).json({
      success: true,
      message: "Part-Admin created successfully. Credentials sent via email.",
      data: {
        id: partAdmin._id,
        name: partAdmin.name,
        email: partAdmin.email,
        phoneNumber: partAdmin.phoneNumber,
        password,
        branch: branchDoc.branchName,
      },
    });
  },
);

/**
 * @desc    Get all Part-Admins
 * @route   GET /api/users/part-admins
 * @access  Super-Admin (all, optional ?branch=), Branch-Admin (own branch)
 */
export const getAllPartAdmins = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const filter: Record<string, unknown> = {};

    // Branch-Admin only sees Part-Admins from their own branch
    if (isBranchManager(req.user)) {
      filter.branch = getUserBranch(req.user);
    }

    // Super-Admin can optionally filter by branch via query param
    if (isAdmin(req.user) && req.query.branch) {
      filter.branch = req.query.branch;
    }

    const partAdmins = await PartAdmin.find(filter)
      .select("-password")
      .populate("branch", "branchName address")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: partAdmins.length,
      data: partAdmins,
    });
  },
);

/**
 * @desc    Delete Part-Admin
 * @route   DELETE /api/users/part-admin/:id
 * @access  Super-Admin, Branch-Admin (own branch only)
 */
export const deletePartAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid Part-Admin ID");
    }

    const pa = await PartAdmin.findById(id);
    if (!pa) {
      res.status(404);
      throw new Error("Part-Admin not found");
    }

    // Branch-Admin can only delete Part-Admins from their own branch
    if (req.user && isBranchManager(req.user)) {
      const branchId = getUserBranch(req.user);
      if (pa.branch.toString() !== branchId?.toString()) {
        res.status(403);
        throw new Error("You can only delete Part-Admins from your own branch");
      }
    }

    await PartAdmin.findByIdAndDelete(id);
    logger.info(`Part-Admin deleted: ${pa.phoneNumber}`);

    res.status(200).json({
      success: true,
      message: "Part-Admin deleted successfully",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// STAFF MANAGEMENT (Branch-Admin only — scoped to their branch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Create Staff
 * @route   POST /api/admin/users/staff
 * @access  Branch-Admin
 */
export const createStaff = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, phoneNumber, address, position } = req.body;

  validateRequiredFields(req.body, [
    "name",
    "email",
    "phoneNumber",
    "address",
    "position",
  ]);

  if (!req.user || !isBranchManager(req.user)) {
    res.status(403);
    throw new Error("Only Branch-Admin can create Staff");
  }

  const branchId = getUserBranch(req.user);
  if (!branchId) {
    res.status(400);
    throw new Error("Branch-Admin must be assigned to a branch");
  }

  const branchDoc = await validateBranchExists(branchId.toString());

  const existing = await Staff.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409);
    throw new Error("A staff member with this email already exists");
  }

  if (await findAccountByPhone(phoneNumber)) {
    res.status(409);
    throw new Error("This phone number is already registered to another account");
  }

  const password = generateRandomPassword();

  const staff = await Staff.create({
    name,
    email,
    phoneNumber,
    address,
    position,

    password,
    branch: branchId,
    createdBy: req.user._id,
  });

  sendWelcomeEmail({
    to: email,
    name,
    phoneNumber,
    password,
    role: "Staff",
    branchName: branchDoc.branchName,
    position,
  }).catch((err) => logger.error("Welcome email failed for Staff:", err));

  logger.info(
    `Staff created: ${staff._id} (${position}) for branch ${branchDoc.branchName}`,
  );

  res.status(201).json({
    success: true,
    message: "Staff created successfully. Credentials sent via email.",
    data: {
      id: staff._id,
      name: staff.name,
      email: staff.email,
      phoneNumber: staff.phoneNumber,
      password,
      position: staff.position,
      branch: branchDoc.branchName,
    },
  });
});
/**
 * @desc    Get all Staff for Branch-Admin's branch
 * @route   GET /api/admin/users/staff
 * @access  Branch-Admin, Super-Admin
 */
export const getAllStaff = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const filter: Record<string, unknown> = {};

  // Branch-Admin can only see staff from their own branch
  if (isBranchManager(req.user)) {
    filter.branch = getUserBranch(req.user);
  }

  // Super-Admin can optionally filter by branch via query param
  if (isAdmin(req.user) && req.query.branch) {
    filter.branch = req.query.branch;
  }

  const staff = await Staff.find(filter)
    .select("-password")
    .populate("branch", "branchName address")
    .populate("createdBy", "name phoneNumber")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: staff.length,
    data: staff,
  });
});

/**
 * @desc    Delete Staff
 * @route   DELETE /api/admin/users/staff/:id
 * @access  Branch-Admin (own branch only), Super-Admin
 */
export const deleteStaff = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid Staff ID");
  }

  const staff = await Staff.findById(id);
  if (!staff) {
    res.status(404);
    throw new Error("Staff not found");
  }

  // Branch-Admin can only delete staff from their own branch
  if (req.user && isBranchManager(req.user)) {
    const branchId = getUserBranch(req.user);
    if (staff.branch.toString() !== branchId?.toString()) {
      res.status(403);
      throw new Error("You can only delete staff from your own branch");
    }
  }

  await Staff.findByIdAndDelete(id);
  logger.info(`Staff deleted: ${staff.phoneNumber}`);

  res.status(200).json({
    success: true,
    message: "Staff deleted successfully",
  });
});

// ─── Developer ───────────────────────────────────────────────────────────────

/**
 * @desc    Create a Developer account
 * @route   POST /api/users/developer
 * @access  Super-Admin only
 *
 * Unlike the branch roles, Developer takes no `branch` — it is a project-wide
 * maintenance account, so there is nothing to scope it to and Branch-Admins
 * cannot create one.
 */
export const createDeveloper = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, email, phoneNumber } = req.body;

    if (!req.user || !isAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Super-Admin can create Developers");
    }

    validateRequiredFields(req.body, ["name", "email", "phoneNumber"]);

    const existing = await Developer.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409);
      throw new Error("A Developer with this email already exists");
    }

    if (await findAccountByPhone(phoneNumber)) {
      res.status(409);
      throw new Error(
        "This phone number is already registered to another account",
      );
    }

    const password = generateRandomPassword();

    const developer = await Developer.create({
      name,
      email,
      phoneNumber,
      password,
      createdBy: req.user._id,
    });

    sendWelcomeEmail({
      to: email,
      name,
      phoneNumber,
      password,
      role: "Developer",
    }).catch((err) => logger.error("Welcome email failed for Developer:", err));

    logger.info(`Developer created: ${developer._id}`);

    res.status(201).json({
      success: true,
      message: "Developer created successfully. Credentials sent via email.",
      data: {
        id: developer._id,
        name: developer.name,
        email: developer.email,
        phoneNumber: developer.phoneNumber,
        password,
      },
    });
  },
);

/**
 * @desc    Get all Developers
 * @route   GET /api/users/developers
 * @access  Super-Admin only
 */
export const getAllDevelopers = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Super-Admin can list Developers");
    }

    const developers = await Developer.find()
      .select("-password")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: developers.length,
      data: developers,
    });
  },
);

/**
 * @desc    Delete a Developer
 * @route   DELETE /api/users/developer/:id
 * @access  Super-Admin only
 */
export const deleteDeveloper = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.user || !isAdmin(req.user)) {
      res.status(403);
      throw new Error("Only Super-Admin can delete Developers");
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid Developer ID");
    }

    const dev = await Developer.findById(id);
    if (!dev) {
      res.status(404);
      throw new Error("Developer not found");
    }

    await Developer.findByIdAndDelete(id);
    logger.info(`Developer deleted: ${dev.email}`);

    res.status(200).json({
      success: true,
      message: "Developer deleted successfully",
    });
  },
);

// ─── Staff ───────────────────────────────────────────────────────────────────
