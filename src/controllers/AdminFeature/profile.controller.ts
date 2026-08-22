import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { UserProfileModel } from "../../models/UserProfile";
import { getUserRole } from "../../types/user.types";
import { findAccountByPhone } from "../../utils/roleModels";
import logger from "../../utils/logger";

const PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * Shape the merged profile: identity from the authenticated role document,
 * extras from UserProfile.
 */
function buildProfile(user: any, profile: any) {
  const branch =
    user.branch && typeof user.branch === "object"
      ? { _id: user.branch._id, branchName: user.branch.branchName }
      : undefined;

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: getUserRole(user),
    position: user.position,
    branch,
    // Address: profile override first, then the role-model address (Super-Admin
    // has none, so it may be undefined).
    address: profile?.address ?? user.address,
    bloodGroup: profile?.bloodGroup,
    lifeInsurance: profile?.lifeInsurance,
    scanfleetStickerId: profile?.scanfleetStickerId,
  };
}

/**
 * @desc    Get the current user's merged profile (identity + extras)
 * @route   GET /api/users/me
 * @access  Any authenticated user
 */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const user = req.user as any;
  const profile = await UserProfileModel.findOne({ userId: user._id });

  res.status(200).json({ success: true, data: buildProfile(user, profile) });
});

/**
 * @desc    Upsert the current user's profile extras
 * @route   PATCH /api/users/me
 * @access  Any authenticated user (own profile only)
 */
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const user = req.user as any;
  const { bloodGroup, lifeInsurance, scanfleetStickerId, address, phoneNumber } =
    req.body;

  // phoneNumber lives on the role document itself (matches the other 4 roles),
  // not on UserProfile — it's the identity used for OTP login, so it needs the
  // same format + cross-role uniqueness guarantees as account creation.
  if (phoneNumber !== undefined) {
    if (!PHONE_REGEX.test(phoneNumber)) {
      res.status(400);
      throw new Error("Please provide a valid 10-digit phone number");
    }

    const match = await findAccountByPhone(phoneNumber);
    if (match && match.doc._id.toString() !== user._id.toString()) {
      res.status(409);
      throw new Error("This phone number is already registered to another account");
    }

    user.phoneNumber = phoneNumber;
    await user.save();
  }

  // Only set fields that were actually provided.
  const set: Record<string, unknown> = { role: getUserRole(user) };
  if (bloodGroup !== undefined) set.bloodGroup = bloodGroup;
  if (lifeInsurance !== undefined) set.lifeInsurance = lifeInsurance;
  if (scanfleetStickerId !== undefined) set.scanfleetStickerId = scanfleetStickerId;
  if (address !== undefined) set.address = address;

  const profile = await UserProfileModel.findOneAndUpdate(
    { userId: user._id },
    { $set: set, $setOnInsert: { userId: user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  logger.info(`Profile updated for ${getUserRole(user)} ${user._id}`);

  res.status(200).json({
    success: true,
    message: "Profile updated",
    data: buildProfile(user, profile),
  });
});
