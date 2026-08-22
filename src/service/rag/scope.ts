import mongoose from "mongoose";
import { AuthenticatedUser, getUserBranch, isAdmin } from "../../types/user.types";

export type BranchScope = mongoose.Types.ObjectId | "all";

/**
 * Resolves the branch scope for a RAG query, mirroring the `branchFilter()`
 * pattern used by partsStats.controller.ts: Super-Admin defaults to "all"
 * branches (overridable via an explicit branchId), branch-scoped roles are
 * forced to their own branch regardless of any requested branchId. This is
 * the same rule dashboards use — RAG and dashboards must never disagree on
 * scope, so both derive it from getUserBranch()/isAdmin() directly rather
 * than each reimplementing the logic.
 */
export function resolveBranchScope(
  user: AuthenticatedUser,
  branchIdOverride?: string,
): BranchScope | null {
  if (isAdmin(user)) {
    if (!branchIdOverride) return "all";
    if (!mongoose.Types.ObjectId.isValid(branchIdOverride)) return null;
    return new mongoose.Types.ObjectId(branchIdOverride);
  }
  const branch = getUserBranch(user);
  if (!branch || !mongoose.Types.ObjectId.isValid(branch)) return null;
  return new mongoose.Types.ObjectId(branch);
}
