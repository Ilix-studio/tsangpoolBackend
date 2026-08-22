import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import MaintenanceServiceModel, {
  type MaintenanceRaiserModel,
  type MaintenanceStatus,
} from "../../models/MaintenanceService";
import logger from "../../utils/logger";
import {
  ROLES,
  getUserRole,
  getUserBranch,
  isAdmin,
  isDeveloper,
} from "../../types/user.types";

/**
 * Which collection each raising role lives in. A request from a role absent
 * here is rejected — this is the single source of truth for "who can message
 * the Developer", and it must stay in step with the `raisedByModel` enum on
 * the model and the `authorize(...)` list on the create route.
 */
const RAISER_MODEL_BY_ROLE: Record<string, MaintenanceRaiserModel> = {
  // Super-Admin both raises and receives: they can file work for a Developer
  // directly, and still see the whole queue on read. Their account carries no
  // branch, so these records are stored with `branch: null`.
  [ROLES.SUPER_ADMIN]: "Admin",
  [ROLES.BRANCH_ADMIN]: "BranchManager",
  [ROLES.SERVICE_ADMIN]: "ServiceAdmin",
  [ROLES.PART_ADMIN]: "PartAdmin",
};

const VALID_STATUSES: MaintenanceStatus[] = ["open", "in_progress", "resolved"];

/**
 * @desc    Raise a maintenance request (the "message the developer" action —
 *          creating one IS creating a maintenance service record).
 * @route   POST /api/maintenance
 * @access  Super-Admin, Branch-Admin, Service-Admin, Part-Admin
 */
export const createMaintenanceService = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const role = getUserRole(req.user);
    const raisedByModel = RAISER_MODEL_BY_ROLE[role];
    if (!raisedByModel) {
      res.status(403);
      throw new Error(`Role "${role}" cannot raise maintenance requests`);
    }

    const { title, description, deadline, priority } = req.body;

    if (!title || !String(title).trim()) {
      res.status(400);
      throw new Error("Title is required");
    }
    if (!description || !String(description).trim()) {
      res.status(400);
      throw new Error("Description is required");
    }

    // Deadline is optional; a value that is present but unreadable is a
    // client mistake worth surfacing rather than silently dropping.
    let deadlineDate: Date | null = null;
    if (deadline !== undefined && deadline !== null && deadline !== "") {
      const parsed = new Date(deadline);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400);
        throw new Error("Deadline is not a valid date");
      }
      deadlineDate = parsed;
    }

    const record = await MaintenanceServiceModel.create({
      title: String(title).trim(),
      description: String(description).trim(),
      deadline: deadlineDate,
      priority: ["low", "normal", "high"].includes(priority)
        ? priority
        : "normal",
      raisedBy: req.user._id,
      raisedByModel,
      raisedByRole: role,
      // Snapshotted so the queue still reads correctly if the account is
      // later removed.
      raisedByName: (req.user as any).name ?? "Unknown",
      branch: getUserBranch(req.user) ?? null,
    });

    logger.info(`Maintenance request raised by ${role}: ${record._id}`);

    res.status(201).json({
      success: true,
      message: "Maintenance request submitted",
      data: record,
    });
  },
);

/**
 * @desc    List maintenance requests. Developer/Super-Admin see every request;
 *          a raising role sees only the ones they filed.
 * @route   GET /api/maintenance?status=&page=&limit=
 * @access  Developer, Super-Admin, Branch-Admin, Service-Admin, Part-Admin
 */
export const getMaintenanceServices = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { isActive: true };

    const status = String(req.query.status ?? "").trim();
    if (status && VALID_STATUSES.includes(status as MaintenanceStatus)) {
      filter.status = status;
    }

    // Reporters get their own feed only — this queue is not a cross-branch
    // read for them, it is "what I asked for and where it got to".
    const seesEverything = isDeveloper(req.user) || isAdmin(req.user);
    if (!seesEverything) {
      filter.raisedBy = req.user._id;
    }

    const [records, total, statusCounts] = await Promise.all([
      MaintenanceServiceModel.find(filter)
        .populate("branch", "branchName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      MaintenanceServiceModel.countDocuments(filter),
      // Counts ignore the status filter so the dashboard tabs keep showing
      // totals for every status while one is selected.
      MaintenanceServiceModel.aggregate([
        {
          $match: seesEverything
            ? { isActive: true }
            : { isActive: true, raisedBy: req.user._id },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const counts: Record<string, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
    };
    statusCounts.forEach((row: { _id: string; count: number }) => {
      counts[row._id] = row.count;
    });

    res.status(200).json({
      success: true,
      data: records,
      counts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  },
);

/**
 * @desc    Update a request's status / developer note.
 * @route   PATCH /api/maintenance/:id
 * @access  Developer, Super-Admin
 */
export const updateMaintenanceService = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid maintenance request ID");
    }

    const record = await MaintenanceServiceModel.findById(id);
    if (!record || !record.isActive) {
      res.status(404);
      throw new Error("Maintenance request not found");
    }

    const { status, developerNote } = req.body;

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        res.status(400);
        throw new Error(
          `Status must be one of: ${VALID_STATUSES.join(", ")}`,
        );
      }
      record.status = status;
      // Stamped on entry to "resolved" and cleared when reopened, so the
      // field never claims a resolution date for an open request.
      record.resolvedAt = status === "resolved" ? new Date() : null;
    }

    if (developerNote !== undefined) {
      record.developerNote = String(developerNote).trim();
    }

    await record.save();
    logger.info(`Maintenance request ${record._id} updated`);

    res.status(200).json({
      success: true,
      message: "Maintenance request updated",
      data: record,
    });
  },
);

/**
 * @desc    Soft-delete a request. Only possible while it is still "open":
 *          once the Developer has started (or resolved) it, the request is
 *          locked for every role — including Developer and Super-Admin — so
 *          work in progress cannot be erased from under them.
 * @route   DELETE /api/maintenance/:id
 * @access  The reporter who raised it, plus Developer / Super-Admin
 */
export const deleteMaintenanceService = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400);
      throw new Error("Invalid maintenance request ID");
    }

    const record = await MaintenanceServiceModel.findById(id);
    if (!record) {
      res.status(404);
      throw new Error("Maintenance request not found");
    }

    // The status lock is checked before ownership on purpose: a started
    // request is undeletable regardless of who is asking, so the answer must
    // not depend on the caller's role.
    if (record.status !== "open") {
      res.status(409);
      throw new Error(
        "This request can no longer be deleted — the developer has already started work on it",
      );
    }

    // Reporters may withdraw only their own request; Developer/Super-Admin may
    // clear any still-open one.
    const privileged = isDeveloper(req.user) || isAdmin(req.user);
    if (!privileged) {
      const ownerId = record.raisedBy?.toString();
      if (ownerId !== (req.user._id as any)?.toString()) {
        res.status(403);
        throw new Error("You can only delete requests you raised");
      }
    }

    // Soft delete, matching how batches are removed elsewhere in the project —
    // the reporter's record of having asked is not destroyed.
    record.isActive = false;
    await record.save();
    logger.info(`Maintenance request ${record._id} soft-deleted`);

    res.status(200).json({
      success: true,
      message: "Maintenance request deleted",
    });
  },
);
