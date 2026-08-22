import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { CustomerProfileModel } from "../../models/CustomerSystem/CustomerProfile";
import { scanfleet } from "../../lib/setting.scanfleet";

/**
 * @desc    Get customer ScanFleet profile (pre-fill data)
 * @route   GET /api/scanfleet/profile
 * @access  Private
 */
export const getScanFleetProfile = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const profile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    if (!profile) {
      res.status(404);
      throw new Error("Profile not found. Please complete your profile first.");
    }

    res.status(200).json({
      success: true,
      data: {
        firstName: profile.firstName,
        middleName: profile.middleName ?? null,
        lastName: profile.lastName,
        phoneNumber: req.customer.phoneNumber,
        email: profile.email,
        familyNumber1: String(profile.familyNumber1),
        familyNumber2: profile.familyNumber2
          ? String(profile.familyNumber2)
          : null,
        bloodGroup: profile.bloodGroup ?? null,
        address: {
          village: profile.village,
          postOffice: profile.postOffice,
          policeStation: profile.policeStation,
          district: profile.district,
          state: profile.state,
        },
        profileCompleted: !!profile.profileCompleted,
      },
    });
  },
);

/**
 * @desc    Activate ScanFleet token using customer profile data
 * @route   POST /api/scanfleet/activate
 * @access  Private
 */
export const activateScanFleetToken = asyncHandler(
  async (req: Request, res: Response) => {
    const { attachCode, vehicleNumber, vehicleType, vehicleModel } = req.body;

    if (!attachCode || !vehicleNumber || !vehicleType || !vehicleModel) {
      res.status(400);
      throw new Error(
        "attachCode, vehicleNumber, vehicleType, and vehicleModel are required",
      );
    }

    if (!req.customer) {
      res.status(401);
      throw new Error("Customer authentication required");
    }

    const profile = await CustomerProfileModel.findOne({
      customer: req.customer._id,
    });

    if (!profile || !profile.profileCompleted) {
      res.status(400);
      throw new Error(
        "Please complete your profile before activating ScanFleet",
      );
    }

    const scanfleetPayload = {
      attachCode,
      customerData: {
        stickerUserName: `${profile.firstName} ${profile.lastName}`.trim(),
        primaryPhoneNumber: String(req.customer.phoneNumber),
        emergencyContact1: String(profile.familyNumber1),
        emergencyContact2: profile.familyNumber2
          ? String(profile.familyNumber2)
          : String(profile.familyNumber1),
        vehicleDetails: {
          vehicleNumber,
          vehicleType,
          vehicleModel,
        },
      },
      shippingAddress: {
        street: `${profile.village}, ${profile.postOffice}`,
        city: profile.policeStation,
        district: profile.district,
        state: profile.state,
        pincode: "",
      },
    };

    let result;
    try {
      result = await scanfleet.bindAttachCode(scanfleetPayload);
    } catch (error: any) {
      res.status(502);
      throw new Error(error.message || "Failed to activate ScanFleet token");
    }

    res.status(200).json({
      success: true,
      message: "ScanFleet safety package activated successfully",
      data: {
        tokenId: result.data.tokenId,
        qrId: result.data.qrId,
        maskedNumber: result.data.maskedNumber,
        vehicleNumber,
        remainingDealerTokens: result.data.remainingBalance,
      },
    });
  },
);
