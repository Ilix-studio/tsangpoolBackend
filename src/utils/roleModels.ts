import mongoose from "mongoose";
import Admin from "../models/Admin";
import BranchManager from "../models/BranchManager";
import ServiceAdmin from "../models/ServiceAdmin";
import PartAdmin from "../models/PartAdmin";
import Developer from "../models/Developer";
import Staff from "../models/Staff";
import { ROLES, UserRole } from "../types/user.types";

export const ROLE_MODEL_LIST: { role: UserRole; model: mongoose.Model<any> }[] = [
  { role: ROLES.SUPER_ADMIN, model: Admin },
  { role: ROLES.BRANCH_ADMIN, model: BranchManager },
  { role: ROLES.SERVICE_ADMIN, model: ServiceAdmin },
  { role: ROLES.PART_ADMIN, model: PartAdmin },
  { role: ROLES.DEVELOPER, model: Developer },
  { role: ROLES.STAFF, model: Staff },
];

export const ROLE_MODEL_MAP: Record<UserRole, mongoose.Model<any>> =
  ROLE_MODEL_LIST.reduce(
    (map, { role, model }) => ({ ...map, [role]: model }),
    {} as Record<UserRole, mongoose.Model<any>>,
  );

/**
 * Looks up which role (if any) a phone number belongs to, in the same
 * Super-Admin -> Branch-Admin -> Service-Admin -> Part-Admin -> Developer
 * -> Staff
 * precedence order used by `protect`. Used for OTP login and for phone
 * dedup checks at account-creation/profile-update time.
 */
export async function findAccountByPhone(
  phoneNumber: string,
): Promise<{ role: UserRole; doc: any } | null> {
  for (const { role, model } of ROLE_MODEL_LIST) {
    const doc = await model.findOne({ phoneNumber });
    if (doc) return { role, doc };
  }
  return null;
}
