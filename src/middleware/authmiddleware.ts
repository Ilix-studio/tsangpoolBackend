import { Request, Response, NextFunction } from "express";
import asyncHandler from "express-async-handler";
import Admin from "../models/Admin";
import BranchManager from "../models/BranchManager";
import ServiceAdmin from "../models/ServiceAdmin";
import PartAdmin from "../models/PartAdmin";
import Developer from "../models/Developer";
import Staff from "../models/Staff";
import ErrorResponse from "../utils/errorResponse";
import { verifyToken } from "../utils/jwt";
import { AuthenticatedUser, getUserRole, UserRole } from "../types/user.types";
import logger from "../utils/logger";

/**
 * Resolve user from JWT across all role collections.
 * Order: Admin → BranchManager → ServiceAdmin → PartAdmin → Developer → Staff
 * Each collection lookup is short-circuited on first match.
 */
export const protect = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer")) {
      return next(new ErrorResponse("Not authorized, no token", 401));
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = verifyToken(token);

      let user: AuthenticatedUser | null = null;

      // 1. Admin (Super-Admin)
      const admin = await Admin.findById(decoded.id).select("-password");
      if (admin) {
        user = admin;
      }

      // 2. BranchManager (Branch-Admin)
      if (!user) {
        const bm = await BranchManager.findById(decoded.id)
          .select("-password")
          .populate("branch", "branchName address");
        if (bm) {
          Object.defineProperty(bm, "role", {
            value: "Branch-Admin" as const,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          user = bm as unknown as AuthenticatedUser;
        }
      }

      // 3. ServiceAdmin
      if (!user) {
        const sa = await ServiceAdmin.findById(decoded.id)
          .select("-password")
          .populate("branch", "branchName address");
        if (sa) {
          Object.defineProperty(sa, "role", {
            value: "Service-Admin" as const,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          user = sa as unknown as AuthenticatedUser;
        }
      }

      // 4. PartAdmin
      if (!user) {
        const pa = await PartAdmin.findById(decoded.id)
          .select("-password")
          .populate("branch", "branchName address");
        if (pa) {
          Object.defineProperty(pa, "role", {
            value: "Part-Admin" as const,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          user = pa as unknown as AuthenticatedUser;
        }
      }

      // 5. Developer (project-wide maintenance role — no branch to populate)
      if (!user) {
        const dev = await Developer.findById(decoded.id).select("-password");
        if (dev) {
          Object.defineProperty(dev, "role", {
            value: "Developer" as const,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          user = dev as unknown as AuthenticatedUser;
        }
      }

      // 6. Staff
      if (!user) {
        const staff = await Staff.findById(decoded.id)
          .select("-password")
          .populate("branch", "branchName address");
        if (staff) {
          Object.defineProperty(staff, "role", {
            value: "Staff" as const,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          user = staff as unknown as AuthenticatedUser;
        }
      }

      if (!user) {
        return next(new ErrorResponse("User not found with this token", 401));
      }

      req.user = user;
      next();
    } catch (err) {
      const reason = err instanceof Error ? err.name : "UnknownError";
      logger.warn(
        `Access token rejected (${reason}) on ${req.method} ${req.originalUrl}`,
      );
      return next(new ErrorResponse("Not authorized, token failed", 401));
    }
  },
);

/**
 * Restrict route access to specific roles.
 */
export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ErrorResponse("User not found", 401));
    }

    const userRole = getUserRole(req.user);

    if (!roles.includes(userRole)) {
      return next(
        new ErrorResponse(
          `Role "${userRole}" is not authorized to access this route`,
          403,
        ),
      );
    }
    next();
  };
};
