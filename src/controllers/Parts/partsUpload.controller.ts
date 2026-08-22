import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { PartsReportModel } from "../../models/PartsReport";
import { PartsReportBatchModel } from "../../models/PartsReportBatch";
import {
  matchPartsColumns,
  buildPartsNormalizedRow,
} from "../../utils/partsColumnMatcher";
import { parseDataImportFile, computeRowHash } from "../../service/dataImport.service";
import {
  getCurrentSnapshot,
  diffAgainstSnapshot,
  computeRevenue,
  computeRevenueAfter,
  buildChangesMarkdown,
  DiffRowEntry,
} from "../../service/partsStockDiff.service";
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

/**
 * @desc    Import a parts-stock report (XLSX / CSV / PDF). A parts-stock file
 *          is a full point-in-time inventory snapshot: the upload is diffed
 *          against the current snapshot (by Part Number) rather than
 *          deduped row-by-row — a byte-identical re-upload is rejected
 *          outright (nothing persisted), and a changed upload only persists
 *          the added/changed rows, superseding old values for changed/
 *          removed parts. See service/partsStockDiff.service.ts.
 * @route   POST /api/parts/import
 * @access  Part-Admin, Super-Admin
 */
export const importPartsReport = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400);
      throw new Error("Parts report file required");
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
    );

    if (parsed.rows.length === 0) {
      res.status(400);
      throw new Error("No rows could be extracted from the file");
    }

    const matchResult = matchPartsColumns(parsed.columns);
    if (!matchResult.isValid) {
      res.status(400);
      throw new Error(
        `Missing required columns: ${matchResult.missingRequired.join(", ")}`,
      );
    }

    const rows: DiffRowEntry[] = parsed.rows.map(({ data, needsReview }) => {
      const { normalized, needsReview: normalizeNeedsReview } =
        buildPartsNormalizedRow(data, matchResult);
      return {
        rowData: data,
        normalized,
        needsReview: needsReview || normalizeNeedsReview,
      };
    });

    const snapshot = await getCurrentSnapshot(branchId);
    const diff = diffAgainstSnapshot(rows, snapshot);

    const previous = await PartsReportBatchModel.findOne({
      branchId,
      isActive: true,
    }).sort({ createdAt: -1 });

    if (diff.addedCount === 0 && diff.changedCount === 0 && diff.removedCount === 0) {
      logger.info(
        `Parts-stock upload matched the current data exactly (branch ${branchId}) — nothing imported`,
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

    const changesMarkdown = buildChangesMarkdown({
      previousBatchId: previous?.batchId ?? null,
      previousDate: previous?.createdAt ?? null,
      diff,
      revenueBefore,
      revenueAfter,
    });

    const batchId = `PARTS-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const reviewRows = [...diff.added, ...diff.changed].filter(
      (r) => r.needsReview,
    ).length;
    const importedRows = diff.addedCount + diff.changedCount;

    await PartsReportBatchModel.create({
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
      uploadedBy: req.user!._id,
      uploadedByRole: getUserRole(req.user!),
      previousBatchId: previous?.batchId ?? null,
      addedRows: diff.addedCount,
      changedRows: diff.changedCount,
      removedRows: diff.removedCount,
      unchangedRows: diff.unchangedCount,
      revenueBefore,
      revenueAfter,
      revenueDelta,
      changesMarkdown,
    });

    const now = Date.now();
    const importDate = new Date(now);
    let seq = 0;
    const makeRowDoc = (entry: DiffRowEntry, changeType: "added" | "changed") => {
      seq += 1;
      return {
        partId: `PART-${now}-${String(seq).padStart(6, "0")}`,
        rowData: entry.rowData,
        normalized: entry.normalized,
        rowHash: computeRowHash(entry.rowData),
        detectedColumns: parsed.columns,
        sourceFormat: parsed.format,
        importBatch: batchId,
        importDate,
        fileName: file.originalname,
        branchId,
        uploadedBy: req.user!._id,
        needsReview: entry.needsReview,
        isCurrent: true,
        changeType,
      };
    };

    const newRowDocs = [
      ...diff.added.map((e) => makeRowDoc(e, "added")),
      ...diff.changed.map((e) => makeRowDoc(e, "changed")),
    ];
    if (newRowDocs.length > 0) {
      await PartsReportModel.insertMany(newRowDocs);
    }

    const supersededIds = [
      ...diff.changed.map((c) => c.previous._id),
      ...diff.removed.map((r) => r.previous._id),
    ];
    if (supersededIds.length > 0) {
      await PartsReportModel.updateMany(
        { _id: { $in: supersededIds } },
        { isCurrent: false },
      );
    }

    logger.info(
      `Parts-stock report committed: +${diff.addedCount} ~${diff.changedCount} -${diff.removedCount} (batch ${batchId}, branch ${branchId})`,
    );

    notify(
      NotificationEvents.partsUpload({
        fileName: file.originalname,
        rowCount: importedRows,
      }),
    ).catch((err) => logger.error(`partsUpload notify failed: ${err}`));

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
        removedRows: diff.removedCount,
        unchangedRows: diff.unchangedCount,
        revenueBefore,
        revenueAfter,
        revenueDelta,
        changesMarkdown,
        errors: [] as { row: number; data: Record<string, any>; error: string }[],
      },
    });
  },
);
