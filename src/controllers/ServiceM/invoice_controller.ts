import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { JobCardInvoiceModel } from "../../models/ServiceM/JobCardInvoice";
import {
  isAdmin,
  canAccessBranch,
  extractId,
  extractBranchId,
  getUserBranch,
} from "../../types/user.types";

/**
 * @desc    Get invoice by invoice _id
 * @route   GET /api/invoices/:id
 * @access  Super-Admin, Branch-Admin, Service-Admin, Customer (owner)
 */
export const getInvoiceById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid invoice ID");
    }

    const invoice = await JobCardInvoiceModel.findById(id)
      .populate("branch", "branchName address phone email")
      .populate("customer", "phoneNumber")
      .populate("vehicle", "numberPlate");

    if (!invoice) {
      res.status(404);
      throw new Error("Invoice not found");
    }

    if (req.customer) {
      if (extractId(invoice.customer) !== req.customer._id.toString()) {
        res.status(403);
        throw new Error("Access denied");
      }
      res.status(200).json({ success: true, data: invoice });
      return;
    }

    if (req.user) {
      if (
        !isAdmin(req.user) &&
        !canAccessBranch(req.user, extractBranchId(invoice.branch))
      ) {
        res.status(403);
        throw new Error("Access denied: branch mismatch");
      }
      res.status(200).json({ success: true, data: invoice });
      return;
    }

    res.status(401);
    throw new Error("Authentication required");
  },
);

/**
 * @desc    List invoices — Super-Admin global, others branch-scoped
 * @route   GET /api/invoices
 * @access  Super-Admin, Branch-Admin, Service-Admin
 */
export const listInvoices = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Authentication required");
    }

    const {
      branchId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query as Record<string, any>;

    const query: Record<string, any> = {};

    if (isAdmin(req.user)) {
      if (branchId) query.branch = branchId;
    } else {
      const userBranch = getUserBranch(req.user);
      query.branch = userBranch;
    }

    if (startDate || endDate) {
      query.issuedAt = {};
      if (startDate) query.issuedAt.$gte = new Date(startDate);
      if (endDate) query.issuedAt.$lte = new Date(endDate);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      JobCardInvoiceModel.find(query)
        .populate("customer", "phoneNumber")
        .populate("vehicle", "numberPlate")
        .populate("branch", "branchName")
        .select("-lineItemsSnapshot -digitalSignatureToken")
        .sort({ issuedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      JobCardInvoiceModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data,
    });
  },
);

/**
 * @desc    Get customer's own invoices
 * @route   GET /api/invoices/my-invoices
 * @access  Customer
 */
export const getMyInvoices = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const { page = 1, limit = 10 } = req.query as Record<string, any>;
    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      JobCardInvoiceModel.find({ customer: req.customer._id })
        .populate("branch", "branchName address")
        .populate("vehicle", "numberPlate")
        .select("-digitalSignatureToken")
        .sort({ issuedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      JobCardInvoiceModel.countDocuments({ customer: req.customer._id }),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data,
    });
  },
);
