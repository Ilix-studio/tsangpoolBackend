import mongoose from "mongoose";
import { CustomerProfileModel } from "../models/CustomerSystem/CustomerProfile";
import { scanfleet } from "../lib/setting.scanfleet";

export interface ScanFleetProfileResponse {
  firstName: string;
  middleName: string | null;
  lastName: string;
  phoneNumber: string;
  email: string;
  familyNumber1: string;
  familyNumber2: string | null;
  bloodGroup: string | null;
  address: {
    village: string;
    postOffice: string;
    policeStation: string;
    district: string;
    state: string;
  };
  profileCompleted: boolean;
}

export interface ActivateTokenPayload {
  attachCode: string;
  vehicleNumber: string;
  vehicleType: string;
  vehicleModel: string;
}

export interface ActivateTokenResult {
  tokenId: string;
  qrId: string;
  maskedNumber: string;
  vehicleNumber: string;
  remainingDealerTokens: number;
}

export class ScanFleetService {
  static async getProfile(
    customerId: mongoose.Types.ObjectId,
    phoneNumber: string,
  ): Promise<ScanFleetProfileResponse> {
    const profile = await CustomerProfileModel.findOne({
      customer: customerId,
    }).lean();

    if (!profile) {
      throw Object.assign(
        new Error("Profile not found. Please complete your profile first."),
        { statusCode: 404 },
      );
    }

    return {
      firstName: profile.firstName,
      middleName: profile.middleName ?? null,
      lastName: profile.lastName,
      phoneNumber,
      email: profile.email || "",
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
    };
  }

  static async activateToken(
    customerId: mongoose.Types.ObjectId,
    phoneNumber: string,
    payload: ActivateTokenPayload,
  ): Promise<ActivateTokenResult> {
    const { attachCode, vehicleNumber, vehicleType, vehicleModel } = payload;

    const profile = await CustomerProfileModel.findOne({
      customer: customerId,
    }).lean();

    if (!profile || !profile.profileCompleted) {
      throw Object.assign(
        new Error("Please complete your profile before activating ScanFleet"),
        { statusCode: 400 },
      );
    }

    const scanfleetPayload = {
      attachCode,
      customerData: {
        stickerUserName: `${profile.firstName} ${profile.lastName}`.trim(),
        primaryPhoneNumber: String(phoneNumber),
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
      throw Object.assign(
        new Error(error.message || "Failed to activate ScanFleet token"),
        { statusCode: 502 },
      );
    }

    return {
      tokenId: result.data.tokenId,
      qrId: result.data.qrId,
      maskedNumber: result.data.maskedNumber,
      vehicleNumber,
      remainingDealerTokens: result.data.remainingBalance,
    };
  }
}
