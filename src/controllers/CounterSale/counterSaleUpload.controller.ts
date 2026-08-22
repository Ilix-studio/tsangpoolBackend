import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { CounterSaleReportModel } from "../../models/CounterSaleReport";
import {
  parseCounterSaleReport,
  extractCuratedFields,
} from "../../service/counterSaleReport.service";
import { getUserBranch, isAdmin } from "../../types/user.types";
import logger from "../../utils/logger";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

/**
 * Resolve which branch this upload belongs to. Upload is Part-Admin only, so
 * in practice this always resolves via getUserBranch — the isAdmin branch
 * exists only for parity with the rest of the codebase's branch-resolution
 * helpers (see partsUpload.controller.ts's identical pattern).
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
 * @desc    Import a Counter Sale Report (XLSX / CSV)
 * @route   POST /api/counter-sale/import
 * @access  Part-Admin
 */
export const importCounterSaleReport = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400);
      throw new Error("Counter sale report file required");
    }

    const branchId = resolveBranchId(req);
    if (!branchId) {
      res.status(400);
      throw new Error("Branch could not be resolved for this upload");
    }
    if (!mongoose.Types.ObjectId.isValid(branchId)) {
      res.status(400);
      throw new Error("Invalid branchId");
    }

    const parsed = await parseCounterSaleReport(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (parsed.rows.length === 0) {
      res.status(400);
      throw new Error("No rows could be extracted from the file");
    }

    const batchId = `CSR-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;
    const importDate = new Date();

    const results = {
      success: false,
      totalRows: parsed.rows.length,
      successCount: 0,
      failureCount: 0,
      reviewCount: 0,
      batchId,
      sourceFormat: parsed.format,
      detectedColumns: parsed.columns,
      errors: [] as {
        row: number;
        data: Record<string, any>;
        error: string;
      }[],
      created: [] as string[],
    };

    for (let i = 0; i < parsed.rows.length; i++) {
      const { data } = parsed.rows[i];
      const rowNumber = i + 2; // header is row 1

      try {
        const curated = extractCuratedFields(data);

        const existing = await CounterSaleReportModel.findOne({
          branchId,
          cpotcOrderNumber: curated.cpotcOrderNumber,
          isActive: true,
        });
        if (existing) {
          throw new Error(
            `Duplicate row (CPOTC Order # "${curated.cpotcOrderNumber}" already imported)`,
          );
        }

        const count = await CounterSaleReportModel.countDocuments();
        const saleId = `CSR-${Date.now()}-${String(count + 1).padStart(5, "0")}`;

        await CounterSaleReportModel.create({
          saleId,
          cpotcOrderNumber: curated.cpotcOrderNumber,
          rowData: data,
          detectedColumns: parsed.columns,
          sourceFormat: parsed.format,
          organization: curated.organization,
          accountName: curated.accountName,
          purchaseOrderDate: curated.purchaseOrderDate,
          totalInvoice: curated.totalInvoice,
          importBatch: batchId,
          importDate,
          fileName: file.originalname,
          branchId,
          uploadedBy: req.user!._id,
          needsReview: curated.needsReview,
        });

        results.created.push(saleId);
        results.successCount++;
        if (curated.needsReview) results.reviewCount++;
      } catch (error) {
        results.failureCount++;
        results.errors.push({
          row: rowNumber,
          data,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    results.success = results.failureCount === 0;

    logger.info(
      `Counter sale report imported: ${results.successCount}/${results.totalRows} (batch ${batchId}, branch ${branchId})`,
    );

    if (results.successCount > 0) {
      notify(
        NotificationEvents.counterSaleUpload({
          branch: branchId,
          fileName: file.originalname,
          rowCount: results.successCount,
        }),
      ).catch((err) => logger.error(`counterSale notify failed: ${err}`));
    }

    res.status(results.success ? 201 : 207).json({
      success: true,
      message: `Imported ${results.successCount}/${results.totalRows} counter sale records`,
      data: results,
    });
  },
);
