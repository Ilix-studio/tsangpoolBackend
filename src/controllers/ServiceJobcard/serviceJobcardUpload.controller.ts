import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { ServiceJobcardRecordModel } from "../../models/ServiceJobcard/ServiceJobcardRecord";
import { ServiceJobcardBatchModel } from "../../models/ServiceJobcard/ServiceJobcardBatch";
import {
  matchServiceJobcardColumns,
  buildServiceJobcardNormalizedRow,
  getServiceJobcardHeaderAliases,
} from "../../utils/serviceJobcardColumnMatcher";
import { parseDataImportFile, computeRowHash } from "../../service/dataImport.service";
import {
  getCurrentSnapshot,
  diffAgainstSnapshot,
  computeRevenue,
  computeRevenueAfter,
  buildChangesMarkdown,
  DiffRowEntry,
} from "../../service/ServiceJobcard/serviceJobcardDiff.service";
import {
  autoRegisterFromServiceJobcard,
  applyServiceJobcardCorrection,
  disableFreeServicesIfPaid,
  AutoRegisterOutcome,
  NameVerification,
} from "../../service/ServiceJobcard/autoRegisterCustomer.service";
import { getUserBranch, getUserRole, isAdmin } from "../../types/user.types";
import logger from "../../utils/logger";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

/**
 * Resolve which branch this upload/query belongs to.
 * - Part-Admin (and other branch-scoped roles): always their own branch.
 * - Super-Admin: must pass a branchId (body or query).
 */
function resolveBranchId(req: Request): string | null {
  if (req.user && isAdmin(req.user)) {
    const fromReq =
      (req.body?.branchId as string) || (req.query?.branchId as string);
    return fromReq || null;
  }
  const branch = req.user ? getUserBranch(req.user) : null;
  return branch ? branch.toString() : null;
}

interface AutoRegistrationTally {
  vehicleMatchedServiceUpdated: number;
  customersRepaired: number;
  customerCreatedVehicleCreated: number;
  customerMatchedVehicleCreated: number;
  conflicts: number;
  skipped: number;
  freeServicesDisabled: number;
  nameMismatches: number;
}

function tallyOutcome(tally: AutoRegistrationTally, outcome: AutoRegisterOutcome) {
  switch (outcome) {
    case "vehicle_matched_service_updated":
      tally.vehicleMatchedServiceUpdated++;
      break;
    case "vehicle_matched_customer_repaired":
      tally.customersRepaired++;
      break;
    case "customer_created_vehicle_created":
      tally.customerCreatedVehicleCreated++;
      break;
    case "customer_matched_vehicle_created":
      tally.customerMatchedVehicleCreated++;
      break;
    case "customer_matched_vehicle_conflict":
      tally.conflicts++;
      break;
    case "skipped_no_frame_number":
    case "skipped_no_phone":
      tally.skipped++;
      break;
  }
}

function tallyNameVerification(tally: AutoRegistrationTally, v: NameVerification) {
  if (v === "mismatch") tally.nameMismatches++;
}

function emptyTally(): AutoRegistrationTally {
  return {
    vehicleMatchedServiceUpdated: 0,
    customersRepaired: 0,
    customerCreatedVehicleCreated: 0,
    customerMatchedVehicleCreated: 0,
    conflicts: 0,
    skipped: 0,
    freeServicesDisabled: 0,
    nameMismatches: 0,
  };
}

/**
 * @desc    Import a service-jobcard report (XLSX). A job-card export is a
 *          period's newly-closed cards, not a full historical re-export: the
 *          upload is diffed against the current snapshot (by Job Card
 *          Number) rather than deduped row-by-row — a byte-identical
 *          re-upload is rejected outright (nothing persisted), and a
 *          changed upload only persists the added/changed rows. Each row
 *          also drives customer/vehicle auto-registration (phone-based,
 *          unchanged) plus a name-match review flag. See
 *          service/ServiceJobcard/serviceJobcardDiff.service.ts and
 *          service/ServiceJobcard/autoRegisterCustomer.service.ts.
 * @route   POST /api/service-jobcard/import
 * @access  Service-Admin, Super-Admin
 */
export const importServiceJobcardReport = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400);
      throw new Error("Service jobcard report file required");
    }

    const branchId = resolveBranchId(req);
    if (!branchId) {
      res.status(400);
      throw new Error(
        "Branch could not be resolved. Super-Admin must provide branchId.",
      );
    }
    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      res.status(400);
      throw new Error("Invalid branchId");
    }

    const parsed = await parseDataImportFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      { expectedHeaders: getServiceJobcardHeaderAliases() },
    );

    if (parsed.rows.length === 0) {
      res.status(400);
      throw new Error("No rows could be extracted from the file");
    }

    const matchResult = matchServiceJobcardColumns(parsed.columns);
    if (!matchResult.isValid) {
      res.status(400);
      throw new Error(
        `Missing required columns: ${matchResult.missingRequired.join(", ")}`,
      );
    }

    const rows: DiffRowEntry[] = parsed.rows.map(({ data, needsReview }) => {
      const { normalized, needsReview: normalizeNeedsReview } =
        buildServiceJobcardNormalizedRow(data, matchResult);
      return {
        rowData: data,
        normalized,
        needsReview: needsReview || normalizeNeedsReview,
      };
    });

    const snapshot = await getCurrentSnapshot(branchId);
    const diff = diffAgainstSnapshot(rows, snapshot);

    const previous = await ServiceJobcardBatchModel.findOne({
      branchId,
      isActive: true,
    }).sort({ createdAt: -1 });

    if (diff.addedCount === 0 && diff.changedCount === 0) {
      logger.info(
        `Service-jobcard upload matched the current data exactly (branch ${branchId}) — nothing imported`,
      );
      res.status(200).json({
        success: true,
        message:
          "This file matches your last upload — no changes detected, nothing was imported.",
        data: {
          duplicate: true,
          previousBatchId: previous?.batchId ?? null,
          totalRows: parsed.rows.length,
          unchangedRows: diff.unchangedCount,
        },
      });
      return;
    }

    const revenueBefore = computeRevenue(snapshot.values());
    const revenueAfter = computeRevenueAfter(revenueBefore, diff);
    const revenueDelta = Math.round((revenueAfter - revenueBefore) * 100) / 100;

    const tally: AutoRegistrationTally = emptyTally();

    const uploadedById = req.user!._id as mongoose.Types.ObjectId;

    // Run auto-registration BEFORE persisting rows, so each row's outcome
    // (and nameVerification flag) can be stored on its ServiceJobcardRecord.
    const addedWithOutcome = await Promise.all(
      diff.added.map(async (entry) => {
        try {
          const result = await autoRegisterFromServiceJobcard(
            entry.normalized,
            branchId,
            uploadedById,
          );
          tallyOutcome(tally, result.outcome);
          tallyNameVerification(tally, result.nameVerification);
          return { entry, nameVerification: result.nameVerification };
        } catch (autoRegError) {
          logger.warn(
            `Auto-registration failed for an added job card (batch pending, branch ${branchId}): ${
              autoRegError instanceof Error ? autoRegError.message : "Unknown error"
            }`,
          );
          tally.skipped++;
          return { entry, nameVerification: "unverified" as NameVerification };
        }
      }),
    );

    const changedWithOutcome = await Promise.all(
      diff.changed.map(async (entry) => {
        try {
          const result = await applyServiceJobcardCorrection(
            entry.previous.normalized,
            entry.normalized,
            branchId,
            uploadedById,
          );
          tallyOutcome(tally, result.outcome);
          tallyNameVerification(tally, result.nameVerification);
          return { entry, nameVerification: result.nameVerification };
        } catch (autoRegError) {
          logger.warn(
            `Auto-registration correction failed for a changed job card (batch pending, branch ${branchId}): ${
              autoRegError instanceof Error ? autoRegError.message : "Unknown error"
            }`,
          );
          tally.skipped++;
          return { entry, nameVerification: "unverified" as NameVerification };
        }
      }),
    );

    for (const { entry } of [...addedWithOutcome, ...changedWithOutcome]) {
      try {
        const disabled = await disableFreeServicesIfPaid(
          entry.normalized.customerMobile,
          entry.normalized.serviceType,
        );
        if (disabled) tally.freeServicesDisabled++;
      } catch (freeServiceError) {
        logger.warn(
          `Free-service lock failed (branch ${branchId}): ${
            freeServiceError instanceof Error ? freeServiceError.message : "Unknown error"
          }`,
        );
      }
    }

    const changesMarkdown = buildChangesMarkdown({
      previousBatchId: previous?.batchId ?? null,
      previousDate: previous?.createdAt ?? null,
      diff,
      revenueBefore,
      revenueAfter,
      autoRegistration: tally,
    });

    const batchId = `SJC-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const reviewRows = [...diff.added, ...diff.changed].filter(
      (r) => r.needsReview,
    ).length;
    const importedRows = diff.addedCount + diff.changedCount;

    await ServiceJobcardBatchModel.create({
      batchId,
      fileName: file.originalname,
      sourceFormat: parsed.format,
      detectedColumns: parsed.columns,
      totalRows: parsed.rows.length,
      importedRows,
      duplicateRows: diff.unchangedCount,
      reviewRows,
      status: "completed",
      branchId,
      uploadedBy: uploadedById,
      uploadedByRole: getUserRole(req.user!),
      previousBatchId: previous?.batchId ?? null,
      addedRows: diff.addedCount,
      changedRows: diff.changedCount,
      unchangedRows: diff.unchangedCount,
      revenueBefore,
      revenueAfter,
      revenueDelta,
      changesMarkdown,
      autoRegistration: tally,
    });

    const now = Date.now();
    let seq = 0;
    const makeRowDoc = (
      entry: DiffRowEntry,
      changeType: "added" | "changed",
      nameVerification: NameVerification,
    ) => {
      seq += 1;
      return {
        recordId: `SJCROW-${now}-${String(seq).padStart(6, "0")}`,
        rowData: entry.rowData,
        normalized: entry.normalized,
        rowHash: computeRowHash(entry.rowData),
        detectedColumns: parsed.columns,
        sourceFormat: parsed.format,
        importBatch: batchId,
        importDate: new Date(now),
        fileName: file.originalname,
        branchId,
        uploadedBy: uploadedById,
        needsReview: entry.needsReview,
        isCurrent: true,
        changeType,
        nameVerification,
      };
    };

    const newRowDocs = [
      ...addedWithOutcome.map(({ entry, nameVerification }) =>
        makeRowDoc(entry, "added", nameVerification),
      ),
      ...changedWithOutcome.map(({ entry, nameVerification }) =>
        makeRowDoc(entry, "changed", nameVerification),
      ),
    ];
    if (newRowDocs.length > 0) {
      await ServiceJobcardRecordModel.insertMany(newRowDocs);
    }

    const supersededIds = diff.changed.map((c) => c.previous._id);
    if (supersededIds.length > 0) {
      await ServiceJobcardRecordModel.updateMany(
        { _id: { $in: supersededIds } },
        { isCurrent: false },
      );
    }

    logger.info(
      `Service-jobcard report committed: +${diff.addedCount} ~${diff.changedCount} (batch ${batchId}, branch ${branchId})`,
    );

    notify(
      NotificationEvents.serviceJobcardUpload({
        branch: branchId,
        fileName: file.originalname,
        rowCount: importedRows,
      }),
    ).catch((err) => logger.error(`serviceJobcard notify failed: ${err}`));

    res.status(201).json({
      success: true,
      message: `Imported ${importedRows} changed/new row(s) out of ${parsed.rows.length}`,
      data: {
        duplicate: false,
        totalRows: parsed.rows.length,
        importedRows,
        duplicateRows: diff.unchangedCount,
        reviewRows,
        batchId,
        previousBatchId: previous?.batchId ?? null,
        sourceFormat: parsed.format,
        detectedColumns: parsed.columns,
        addedRows: diff.addedCount,
        changedRows: diff.changedCount,
        unchangedRows: diff.unchangedCount,
        revenueBefore,
        revenueAfter,
        revenueDelta,
        changesMarkdown,
        autoRegistration: tally,
        errors: [] as { row: number; data: Record<string, any>; error: string }[],
      },
    });
  },
);

/**
 * @desc    Manually re-run customer/vehicle auto-registration for every row
 *          already stored under a given batch. Safe to call repeatedly: the
 *          underlying dedup (BaseCustomer by phone, CustomerVehicle by frame
 *          number) means an already-registered row just resolves to
 *          "vehicle_matched_service_updated" rather than creating a
 *          duplicate. Exists for batches imported before auto-registration
 *          existed, or rows that were skipped/conflicted the first time
 *          (e.g. missing phone at import time, since corrected) and can
 *          succeed now. Does not touch the diff/snapshot machinery — it only
 *          replays autoRegisterFromServiceJobcard over each row's normalized
 *          fields (Customer, Mobile, Frame Number, Model, ...).
 * @route   POST /api/service-jobcard/batches/:batchId/rerun-registration
 * @access  Service-Admin (own branch only), Super-Admin
 */
export const rerunServiceJobcardRegistration = asyncHandler(
  async (req: Request, res: Response) => {
    const { batchId } = req.params;

    const batch = await ServiceJobcardBatchModel.findOne({
      batchId,
      isActive: true,
    });
    if (!batch) {
      res.status(404);
      throw new Error("Batch not found");
    }

    if (!isAdmin(req.user!)) {
      const userBranch = getUserBranch(req.user!);
      if (!userBranch || userBranch.toString() !== batch.branchId.toString()) {
        res.status(403);
        throw new Error("Not authorized for this branch");
      }
    }

    const branchId = batch.branchId.toString();
    const uploadedById = req.user!._id as mongoose.Types.ObjectId;

    const rows = await ServiceJobcardRecordModel.find({
      importBatch: batchId,
      isActive: true,
    });

    const tally: AutoRegistrationTally = emptyTally();

    for (const row of rows) {
      try {
        const result = await autoRegisterFromServiceJobcard(
          row.normalized,
          branchId,
          uploadedById,
        );
        tallyOutcome(tally, result.outcome);
        tallyNameVerification(tally, result.nameVerification);
      } catch (autoRegError) {
        logger.warn(
          `Manual auto-registration re-run failed for record ${row.recordId} (batch ${batchId}): ${
            autoRegError instanceof Error ? autoRegError.message : "Unknown error"
          }`,
        );
        tally.skipped++;
      }
    }

    logger.info(
      `Manual auto-registration re-run completed for batch ${batchId}: ${rows.length} row(s) processed`,
    );

    res.status(200).json({
      success: true,
      message: `Re-ran registration for ${rows.length} row(s)`,
      data: { batchId, rowCount: rows.length, autoRegistration: tally },
    });
  },
);
