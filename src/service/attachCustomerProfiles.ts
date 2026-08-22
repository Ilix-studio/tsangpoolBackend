import { Types } from "mongoose";
import { CustomerProfileModel } from "../models/CustomerSystem/CustomerProfile";

/**
 * Customer detail fields surfaced on the Sales Report screens. Deliberately a
 * subset of CustomerProfile — everything here is already visible to a
 * Branch-Admin through the customer dashboards.
 */
const PROFILE_FIELDS =
  "customer firstName middleName lastName email village postOffice policeStation district state bloodGroup familyNumber1 familyNumber2 profileCompleted";

export interface AttachedCustomerProfile {
  _id: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;
  email?: string;
  village?: string;
  postOffice?: string;
  policeStation?: string;
  district?: string;
  state?: string;
  bloodGroup?: string;
  familyNumber1?: number;
  familyNumber2?: number;
  profileCompleted: boolean;
}

/** `salesInfo.soldTo` is populated to a doc by the callers, but may be a raw id. */
const soldToId = (stock: any): string | null => {
  const soldTo = stock?.salesInfo?.soldTo;
  if (!soldTo) return null;
  return String(soldTo._id ?? soldTo);
};

/**
 * Attaches the CustomerProfile of each stock item's buyer as `customerProfile`.
 *
 * One extra query for the whole page rather than one per row — the Sales Report
 * tables page at 15-20 rows, so an N+1 over `/api/customer-profile/:customerId`
 * would mean that many round trips per render.
 *
 * A missing profile yields `customerProfile: null` (BaseCustomer exists from the
 * phone-OTP step; CustomerProfile is created separately and may not exist yet),
 * so callers must treat it as optional.
 */
export const attachCustomerProfiles = async <T>(
  stockItems: T[],
): Promise<Array<T & { customerProfile: AttachedCustomerProfile | null }>> => {
  const customerIds = [
    ...new Set(
      stockItems
        .map(soldToId)
        .filter((id): id is string => !!id && Types.ObjectId.isValid(id)),
    ),
  ];

  if (customerIds.length === 0) {
    return stockItems.map((item) => ({
      ...((item as any).toObject?.() ?? item),
      customerProfile: null,
    }));
  }

  const profiles = await CustomerProfileModel.find({
    customer: { $in: customerIds },
  })
    .select(PROFILE_FIELDS)
    .lean();

  const byCustomer = new Map<string, AttachedCustomerProfile>(
    profiles.map((p: any) => [
      String(p.customer),
      {
        _id: String(p._id),
        firstName: p.firstName,
        middleName: p.middleName,
        lastName: p.lastName,
        fullName: [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(" "),
        email: p.email,
        village: p.village,
        postOffice: p.postOffice,
        policeStation: p.policeStation,
        district: p.district,
        state: p.state,
        bloodGroup: p.bloodGroup,
        familyNumber1: p.familyNumber1,
        familyNumber2: p.familyNumber2,
        profileCompleted: !!p.profileCompleted,
      },
    ]),
  );

  return stockItems.map((item) => {
    const id = soldToId(item);
    return {
      ...((item as any).toObject?.() ?? item),
      customerProfile: (id && byCustomer.get(id)) || null,
    };
  });
};
