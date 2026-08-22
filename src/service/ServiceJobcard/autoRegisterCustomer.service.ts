import mongoose from "mongoose";
import { BaseCustomerModel } from "../../models/CustomerSystem/BaseCustomer";
import { CustomerProfileModel } from "../../models/CustomerSystem/CustomerProfile";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";
import { StockConceptCSVModel } from "../../models/BikeSystemModel3/StockConceptCSV";
import { StockConceptModel } from "../../models/BikeSystemModel2/StockConcept";
import logger from "../../utils/logger";

const PHONE_REGEX = /^[6-9]\d{9}$/;

export type AutoRegisterOutcome =
  | "vehicle_matched_service_updated"
  | "vehicle_matched_customer_repaired"
  | "customer_created_vehicle_created"
  | "customer_matched_vehicle_created"
  | "customer_matched_vehicle_conflict"
  | "skipped_no_frame_number"
  | "skipped_no_phone";

export type NameVerification = "match" | "mismatch" | "unverified";

export interface AutoRegisterInput {
  customerName?: string;
  customerMobile?: string;
  frameNumber?: string;
  modelName?: string;
  modelVariant?: string;
  currentKms?: number;
  amcService?: string;
  jobCardClosedDate?: Date;
  partsRevenue?: number;
  lubesRevenue?: number;
  totalJobCardRevenue?: number;
}

function isAmcActive(raw?: string): boolean {
  if (!raw) return false;
  return /^(y|yes|active|true|1)$/i.test(raw.trim());
}

export interface AutoRegisterResult {
  outcome: AutoRegisterOutcome;
  customerId?: string;
  vehicleId?: string;
  nameVerification: NameVerification;
}

function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "").slice(-10);
  return PHONE_REGEX.test(digits) ? digits : null;
}

/** Combine firstName + middleName + lastName into one display string. */
export function combineCustomerName(
  profile: { firstName?: string; middleName?: string; lastName?: string } | null | undefined,
): string {
  if (!profile) return "";
  return [profile.firstName, profile.middleName, profile.lastName]
    .filter((part) => part && part.trim())
    .join(" ")
    .trim();
}

function normalizeNameForCompare(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Dependency-free "close enough" name comparison: exact match after
 * normalization, falling back to a token-overlap check (every word of the
 * shorter name appears, or is a prefix of a word, in the longer one) — no
 * fuzzy-matching library exists anywhere in this repo, and this is a review
 * flag, not a hard gate, so a cheap heuristic is enough.
 */
export function namesReasonablyMatch(a: string, b: string): boolean {
  const na = normalizeNameForCompare(a);
  const nb = normalizeNameForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const wordsA = na.split(" ").filter(Boolean);
  const wordsB = nb.split(" ").filter(Boolean);
  const [shorter, longer] =
    wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  if (shorter.length === 0) return false;
  return shorter.every((word) =>
    longer.some((w) => w === word || w.startsWith(word) || word.startsWith(w)),
  );
}

/**
 * A matched CustomerVehicle's `customer` ref is normally trusted blindly —
 * but it can go dangling if the BaseCustomer collection is ever modified
 * independently of CustomerVehicle (e.g. an out-of-band data cleanup/reset
 * that only touched one collection). When that happens, this repairs the
 * link using the job-card row's own phone number — the same source of
 * truth the "no owner yet" branch below already trusts — instead of
 * silently leaving the vehicle pointed at a customer that no longer
 * exists. Reuses the ORIGINAL customer _id when recreating the
 * BaseCustomer so any other document referencing that same dead id (e.g.
 * a CustomerProfile) becomes valid again too, with no extra writes.
 */
async function resolveOrRepairVehicleCustomer(
  existingVehicle: InstanceType<typeof CustomerVehicleModel>,
  row: AutoRegisterInput,
): Promise<{ customerId: mongoose.Types.ObjectId | null; repaired: boolean }> {
  const linkedCustomerId = existingVehicle.customer as mongoose.Types.ObjectId;
  const customerDoc = await BaseCustomerModel.findById(linkedCustomerId);
  if (customerDoc) {
    return { customerId: linkedCustomerId, repaired: false };
  }

  const phoneNumber = normalizePhone(row.customerMobile);
  if (!phoneNumber) {
    return { customerId: null, repaired: false };
  }

  const phoneMatch = await BaseCustomerModel.findOne({ phoneNumber });
  if (!phoneMatch) {
    const recreated = await BaseCustomerModel.create({
      _id: linkedCustomerId,
      phoneNumber,
      isVerified: false,
      creationSource: "automatic_creation",
    });
    return {
      customerId: recreated._id as unknown as mongoose.Types.ObjectId,
      repaired: true,
    };
  }

  // A BaseCustomer with this phone already exists under a different id
  // (e.g. repaired by an earlier row/upload) — CustomerVehicle.customer is
  // unique, so only relink if that customer doesn't already own a
  // different vehicle. Otherwise this is a genuine conflict; leave the
  // dangling ref alone rather than silently merging two vehicles.
  const alreadyOwnsOther = await CustomerVehicleModel.findOne({
    customer: phoneMatch._id,
    _id: { $ne: existingVehicle._id },
  });
  if (alreadyOwnsOther) {
    return { customerId: null, repaired: false };
  }

  existingVehicle.customer = phoneMatch._id as unknown as mongoose.Types.ObjectId;
  await existingVehicle.save();
  return {
    customerId: phoneMatch._id as unknown as mongoose.Types.ObjectId,
    repaired: true,
  };
}

async function resolveNameVerification(
  customerId: mongoose.Types.ObjectId | string | undefined,
  rowCustomerName?: string,
): Promise<NameVerification> {
  if (!customerId || !rowCustomerName || !rowCustomerName.trim()) return "unverified";
  const profile = await CustomerProfileModel.findOne({ customer: customerId })
    .select("firstName middleName lastName")
    .lean();
  const combined = combineCustomerName(profile as any);
  if (!combined) return "unverified";
  return namesReasonablyMatch(combined, rowCustomerName) ? "match" : "mismatch";
}

/**
 * Auto-registers a customer + vehicle from a service-jobcard import row,
 * bypassing the OTP signup flow — this only runs for bulk historical
 * job-card imports (Service-Admin/Super-Admin uploads), never for live
 * customer signup. Dedupes by phone number (customer) and frame number
 * (vehicle) so re-uploads / repeat service visits don't create duplicates.
 *
 * If the frame number already has an owned CustomerVehicle, no customer is
 * created at all — we just record the service visit on the existing vehicle.
 * A new BaseCustomer + CustomerVehicle (and, if needed, a placeholder
 * StockConceptCSV) are only created when this vehicle has never been
 * assigned an owner in this system.
 *
 * Customer/vehicle matching itself stays phone-based, unchanged from the
 * original DataImport-era behavior — `nameVerification` is purely an
 * additional review flag (does the row's free-text Customer Name reasonably
 * match the phone-matched customer's combined profile name?), never a
 * matching mechanism on its own.
 */
export async function autoRegisterFromServiceJobcard(
  row: AutoRegisterInput,
  branchId: string,
  uploadedBy: mongoose.Types.ObjectId,
): Promise<AutoRegisterResult> {
  const frameNumber = row.frameNumber?.trim().toUpperCase();
  if (!frameNumber) {
    return { outcome: "skipped_no_frame_number", nameVerification: "unverified" };
  }

  // Locate an existing purchase record for this frame number, across both
  // stock models.
  let stockDoc = await StockConceptCSVModel.findOne({ frameNumber });
  let stockType: "StockConcept" | "StockConceptCSV" = "StockConceptCSV";
  if (!stockDoc) {
    const legacyStock = await StockConceptModel.findOne({
      chassisNumber: frameNumber,
    });
    if (legacyStock) {
      stockDoc = legacyStock as any;
      stockType = "StockConcept";
    }
  }

  if (stockDoc) {
    const existingVehicle = await CustomerVehicleModel.findOne({
      stockConcept: stockDoc._id,
    });
    if (existingVehicle) {
      existingVehicle.serviceStatus.lastServiceDate =
        row.jobCardClosedDate ?? existingVehicle.serviceStatus.lastServiceDate;
      existingVehicle.serviceStatus.serviceHistory =
        (existingVehicle.serviceStatus.serviceHistory ?? 0) + 1;
      if (row.currentKms !== undefined) {
        existingVehicle.serviceStatus.kilometers = row.currentKms;
      }
      if (row.amcService !== undefined) {
        existingVehicle.serviceStatus.amcActive = isAmcActive(row.amcService);
      }
      existingVehicle.serviceExpenses.partsRevenue =
        (existingVehicle.serviceExpenses?.partsRevenue ?? 0) +
        (row.partsRevenue ?? 0);
      existingVehicle.serviceExpenses.lubesRevenue =
        (existingVehicle.serviceExpenses?.lubesRevenue ?? 0) +
        (row.lubesRevenue ?? 0);
      existingVehicle.serviceExpenses.totalJobCardRevenue =
        (existingVehicle.serviceExpenses?.totalJobCardRevenue ?? 0) +
        (row.totalJobCardRevenue ?? 0);
      await existingVehicle.save();
      const { customerId, repaired } = await resolveOrRepairVehicleCustomer(
        existingVehicle,
        row,
      );
      const nameVerification = await resolveNameVerification(
        customerId ?? undefined,
        row.customerName,
      );
      return {
        outcome: repaired
          ? "vehicle_matched_customer_repaired"
          : "vehicle_matched_service_updated",
        vehicleId: String(existingVehicle._id),
        customerId: customerId ? String(customerId) : undefined,
        nameVerification,
      };
    }
  }

  // No owner on record yet — need a customer to attach this vehicle to.
  const phoneNumber = normalizePhone(row.customerMobile);
  if (!phoneNumber) {
    return { outcome: "skipped_no_phone", nameVerification: "unverified" };
  }

  let customer = await BaseCustomerModel.findOne({ phoneNumber });
  const customerCreated = !customer;
  if (!customer) {
    customer = await BaseCustomerModel.create({
      phoneNumber,
      isVerified: false,
      creationSource: "automatic_creation",
    });
  }

  // CustomerVehicle.customer is unique — this customer may already own a
  // different vehicle. Don't violate that constraint; just log the conflict.
  const existingForCustomer = await CustomerVehicleModel.findOne({
    customer: customer._id,
  });
  if (existingForCustomer) {
    logger.warn(
      `Auto-registration: customer ${customer._id} already owns a vehicle, skipping link for frame ${frameNumber}`,
    );
    const nameVerification = await resolveNameVerification(customer._id, row.customerName);
    return {
      outcome: "customer_matched_vehicle_conflict",
      customerId: String(customer._id),
      nameVerification,
    };
  }

  const wasPreExistingUnsoldStock = !!stockDoc;

  if (!stockDoc) {
    // Bike wasn't sold through this system at all (walk-in / bought
    // elsewhere) — create a minimal placeholder stock record so the vehicle
    // still gets tracked.
    const stockCount = await StockConceptCSVModel.countDocuments();
    const stockId = `AUTO-${Date.now()}-${String(stockCount + 1).padStart(4, "0")}`;
    const combinedModel =
      [row.modelName, row.modelVariant].filter(Boolean).join(" ").trim() ||
      "Unknown";
    stockDoc = await StockConceptCSVModel.create({
      stockId,
      modelVariant: combinedModel,
      engineNumber: `AUTO-${frameNumber}`,
      frameNumber,
      color: "Unknown",
      creationSource: "automatic_creation",
      csvImportBatch: `AUTO-JOBCARD-${Date.now()}`,
      csvImportDate: new Date(),
      csvFileName: "service-jobcard-auto-registration",
      csvData: { source: "service-jobcard-auto-registration" },
      detectedColumns: [],
      schemaVersion: 1,
      stockStatus: {
        status: "Service",
        location: "UNKNOWN",
        branchId,
        updatedBy: uploadedBy,
      },
    });
    stockType = "StockConceptCSV";
  }

  const vehicle = await CustomerVehicleModel.create({
    stockConcept: stockDoc._id,
    stockType,
    customer: customer._id,
    isPaid: false,
    isFinance: false,
    insurance: false,
    serviceStatus: {
      lastServiceDate: row.jobCardClosedDate,
      serviceHistory: 1,
      kilometers: row.currentKms ?? 0,
      amcActive: isAmcActive(row.amcService),
    },
    serviceExpenses: {
      partsRevenue: row.partsRevenue ?? 0,
      lubesRevenue: row.lubesRevenue ?? 0,
      totalJobCardRevenue: row.totalJobCardRevenue ?? 0,
    },
  });

  if (stockType === "StockConceptCSV") {
    (stockDoc as any).salesInfo = {
      soldTo: customer._id,
      customerVehicleId: vehicle._id,
    };
    // A pre-existing stock record (found "Available") is now owned — flip it
    // out of the available-for-sale pool, same as the manual assign flow.
    // A freshly-created placeholder is already "Service", left as-is.
    if (wasPreExistingUnsoldStock) {
      (stockDoc as any).stockStatus.status = "Sold";
    }
    await (stockDoc as any).save();
  } else if (stockType === "StockConcept" && wasPreExistingUnsoldStock) {
    (stockDoc as any).salesInfo = {
      soldTo: customer._id,
      customerVehicleId: vehicle._id,
    };
    (stockDoc as any).stockStatus.status = "Sold";
    await (stockDoc as any).save();
  }

  const nameVerification = customerCreated
    ? "unverified" // brand-new auto-created BaseCustomer has no CustomerProfile yet
    : await resolveNameVerification(customer._id, row.customerName);

  return {
    outcome: customerCreated
      ? "customer_created_vehicle_created"
      : "customer_matched_vehicle_created",
    customerId: String(customer._id),
    vehicleId: String(vehicle._id),
    nameVerification,
  };
}

/**
 * Applies a revenue correction to an already-linked CustomerVehicle when a
 * previously-seen Job Card Number reappears with different figures — adds
 * the DELTA (new − old) rather than either re-adding the full new value
 * (double-counting) or ignoring the correction. Does not touch
 * serviceHistory/kilometers/lastServiceDate: this is a correction to an
 * existing service event, not a new visit. Falls back to a fresh
 * auto-registration run if no vehicle is linked yet for this frame (e.g. the
 * original row was skipped_no_phone).
 */
export async function applyServiceJobcardCorrection(
  oldRow: AutoRegisterInput,
  newRow: AutoRegisterInput,
  branchId: string,
  uploadedBy: mongoose.Types.ObjectId,
): Promise<AutoRegisterResult> {
  const frameNumber = newRow.frameNumber?.trim().toUpperCase();
  if (!frameNumber) {
    return { outcome: "skipped_no_frame_number", nameVerification: "unverified" };
  }

  let stockDoc = await StockConceptCSVModel.findOne({ frameNumber });
  if (!stockDoc) {
    const legacyStock = await StockConceptModel.findOne({ chassisNumber: frameNumber });
    if (legacyStock) stockDoc = legacyStock as any;
  }

  if (stockDoc) {
    const existingVehicle = await CustomerVehicleModel.findOne({
      stockConcept: stockDoc._id,
    });
    if (existingVehicle) {
      const deltaParts = (newRow.partsRevenue ?? 0) - (oldRow.partsRevenue ?? 0);
      const deltaLubes = (newRow.lubesRevenue ?? 0) - (oldRow.lubesRevenue ?? 0);
      const deltaTotal =
        (newRow.totalJobCardRevenue ?? 0) - (oldRow.totalJobCardRevenue ?? 0);
      existingVehicle.serviceExpenses.partsRevenue =
        (existingVehicle.serviceExpenses?.partsRevenue ?? 0) + deltaParts;
      existingVehicle.serviceExpenses.lubesRevenue =
        (existingVehicle.serviceExpenses?.lubesRevenue ?? 0) + deltaLubes;
      existingVehicle.serviceExpenses.totalJobCardRevenue =
        (existingVehicle.serviceExpenses?.totalJobCardRevenue ?? 0) + deltaTotal;
      await existingVehicle.save();
      const { customerId, repaired } = await resolveOrRepairVehicleCustomer(
        existingVehicle,
        newRow,
      );
      const nameVerification = await resolveNameVerification(
        customerId ?? undefined,
        newRow.customerName,
      );
      return {
        outcome: repaired
          ? "vehicle_matched_customer_repaired"
          : "vehicle_matched_service_updated",
        vehicleId: String(existingVehicle._id),
        customerId: customerId ? String(customerId) : undefined,
        nameVerification,
      };
    }
  }

  // No vehicle linked yet for this frame (e.g. the original row was
  // skipped_no_phone) — self-heal by running a fresh auto-registration with
  // the corrected values.
  return autoRegisterFromServiceJobcard(newRow, branchId, uploadedBy);
}

/**
 * Once a service-jobcard row shows a PAID service against a phone number
 * already on record, that customer's complimentary FREE_SERVICES (see
 * types/serviceBooking.types.ts — booked via createServiceBooking) are
 * switched off for good; there's no re-enabling path since this only ever
 * flips false -> true and free eligibility is a one-time perk, not a
 * per-visit toggle.
 */
export async function disableFreeServicesIfPaid(
  customerMobile: string | undefined,
  serviceType: string | undefined,
): Promise<boolean> {
  const phoneNumber = normalizePhone(customerMobile);
  if (!phoneNumber) return false;
  if (serviceType?.trim().toLowerCase() !== "paid") return false;

  const customer = await BaseCustomerModel.findOne({ phoneNumber });
  if (!customer || customer.freeServicesDisabled) return false;

  customer.freeServicesDisabled = true;
  await customer.save();
  logger.info(
    `Free services disabled for customer ${phoneNumber} — PAID service recorded via job-card import`,
  );
  return true;
}
