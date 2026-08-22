import { Document } from "mongoose";
import { IAdmin } from "../models/Admin";
import { IBranchManager } from "../models/BranchManager";
import { IServiceAdmin } from "../models/ServiceAdmin";
import { IStaff } from "../models/Staff";
import { IPartAdmin } from "../models/PartAdmin";
import { IDeveloper } from "../models/Developer";

// ─── Role Constants ──────────────────────────────────────────────────────────

export const ROLES = {
  SUPER_ADMIN: "Super-Admin",
  BRANCH_ADMIN: "Branch-Admin",
  SERVICE_ADMIN: "Service-Admin",
  PART_ADMIN: "Part-Admin",
  DEVELOPER: "Developer",
  STAFF: "Staff",
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

// ─── Authenticated User Union ────────────────────────────────────────────────

export type AuthenticatedUser =
  | (Document & IAdmin)
  | (Document & IBranchManager & { role: "Branch-Admin" })
  | (Document & IServiceAdmin & { role: "Service-Admin" })
  | (Document & IPartAdmin & { role: "Part-Admin" })
  | (Document & IDeveloper & { role: "Developer" })
  | (Document & IStaff & { role: "Staff" });

// ─── Type Guards ─────────────────────────────────────────────────────────────

export function isAdmin(user: AuthenticatedUser): user is Document & IAdmin {
  return "role" in user && (user as any).role === ROLES.SUPER_ADMIN;
}

export function isBranchManager(
  user: AuthenticatedUser,
): user is Document & IBranchManager & { role: "Branch-Admin" } {
  return getUserRole(user) === ROLES.BRANCH_ADMIN;
}

export function isServiceAdmin(
  user: AuthenticatedUser,
): user is Document & IServiceAdmin & { role: "Service-Admin" } {
  // Check explicit role assignment OR model name (Object.assign on Mongoose doc can be unreliable)
  if (getUserRole(user) === ROLES.SERVICE_ADMIN) return true;
  return (user as any).constructor?.modelName === "ServiceAdmin";
}

export function isPartAdmin(
  user: AuthenticatedUser,
): user is Document & IPartAdmin & { role: "Part-Admin" } {
  // Check explicit role assignment OR model name (Object.assign on Mongoose doc can be unreliable)
  if (getUserRole(user) === ROLES.PART_ADMIN) return true;
  return (user as any).constructor?.modelName === "PartAdmin";
}

export function isDeveloper(
  user: AuthenticatedUser,
): user is Document & IDeveloper & { role: "Developer" } {
  // Check explicit role assignment OR model name (Object.assign on Mongoose doc can be unreliable)
  if (getUserRole(user) === ROLES.DEVELOPER) return true;
  return (user as any).constructor?.modelName === "Developer";
}

export function isStaff(
  user: AuthenticatedUser,
): user is Document & IStaff & { role: "Staff" } {
  return getUserRole(user) === ROLES.STAFF;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getUserRole(user: AuthenticatedUser): UserRole {
  if ("role" in user && typeof (user as any).role === "string") {
    return (user as any).role as UserRole;
  }
  // Developer carries email + isActive just like Admin, so it has to be
  // distinguished by model name before the Super-Admin fallback below —
  // otherwise a doc that lost its explicit `role` would read as Super-Admin.
  if ((user as any).constructor?.modelName === "Developer") {
    return ROLES.DEVELOPER;
  }
  if ("email" in user && "isActive" in user) return ROLES.SUPER_ADMIN;
  if ("phoneNumber" in user && "position" in user) return ROLES.STAFF;
  if ("phoneNumber" in user && "createdBy" in user) {
    const modelName = (user as any).constructor?.modelName;
    if (modelName === "ServiceAdmin") return ROLES.SERVICE_ADMIN;
    if (modelName === "PartAdmin") return ROLES.PART_ADMIN;
    if (modelName === "Developer") return ROLES.DEVELOPER;
    return ROLES.BRANCH_ADMIN;
  }
  return ROLES.STAFF;
}

export function getUserBranch(user: AuthenticatedUser): string | null {
  // Super-Admin and Developer are project-wide, not branch-scoped.
  if (isAdmin(user) || isDeveloper(user)) return null;
  const branch = (user as any).branch;
  if (!branch) return null;
  return typeof branch === "object" && branch._id
    ? branch._id.toString()
    : branch.toString();
}

export function canAccessBranch(
  user: AuthenticatedUser,
  branchId: string,
): boolean {
  if (isAdmin(user)) return true;
  const userBranch = getUserBranch(user);
  if (!userBranch) return false;
  return userBranch === branchId;
}

/**
 * Safely extracts a string ID from either a populated Mongoose document
 * object ({ _id, ...fields }) or a raw ObjectId / string.
 */
export function extractId(ref: any): string {
  if (!ref) return "";
  if (typeof ref === "object" && ref._id) return ref._id.toString();
  return ref.toString();
}

/**
 * Alias for extractId — used specifically for branch fields to make
 * call sites self-documenting.
 */
export function extractBranchId(ref: any): string {
  return extractId(ref);
}

// ─── Express Extension ───────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
