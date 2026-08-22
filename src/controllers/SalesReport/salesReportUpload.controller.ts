import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { SalesReportModel } from "../../models/SalesReport";
import {
  parseSalesReport,
  extractCuratedFields,
} from "../../service/salesReport.service";
import { matchSalesReportColumns } from "../../utils/salesReportColumnMatcher";
import { processSalesReportRow } from "../../service/salesReport/processSalesReportRow.service";
import { getUserBranch, isAdmin } from "../../types/user.types";
import logger from "../../utils/logger";
import { notify } from "../../service/pushNotification.service";
import { NotificationEvents } from "../../service/notificationTargeting";

/**
 * Resolve which branch this upload belongs to. Upload is Branch-Admin only,
 * so in practice this always resolves via getUserBranch — the isAdmin branch
 * exists only for parity with the rest of the codebase's branch-resolution
 * helpers (see counterSaleUpload.controller.ts's identical pattern).
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
 * @desc    Import a Sales Report of already-sold vehicles (XLSX / CSV).
 *          Matches each row against StockConceptCSV by Frame No or Engine
 *          No, flips matched stock to "Sold", and creates/links the
 *          customer (creationSource: "new_csv_sales_report").
 * @route   POST /api/sales-report/import
 * @access  Branch-Admin
 */
export const importSalesReport = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400);
      throw new Error("Sales report file required");
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

    const parsed = await parseSalesReport(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (parsed.rows.length === 0) {
      res.status(400);
      throw new Error("No rows could be extracted from the file");
    }

    // Mandatory field checker — gate the whole upload before touching any
    // rows, and report exactly which required columns are missing.
    const matchResult = matchSalesReportColumns(parsed.columns);
    if (!matchResult.isValid) {
      res.status(400);
      throw new Error(
        `Missing required columns: ${matchResult.missingRequired
          .map((f) => f.label)
          .join(", ")}`,
      );
    }

    const batchId = `SR-${Date.now()}-${Math.random()
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
      matchedCount: 0,
      unmatchedCount: 0,
      conflictCount: 0,
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
        const curated = extractCuratedFields(data, matchResult);

        const existing = await SalesReportModel.findOne({
          branchId,
          frameNo: curated.frameNo,
          isActive: true,
        });
        if (existing) {
          throw new Error(
            `Duplicate row (Frame No "${curated.frameNo}" already imported)`,
          );
        }

        const outcome = await processSalesReportRow(
          {
            modelName: curated.modelName,
            modelVariant: curated.modelVariant,
            customerFirstName: curated.customerFirstName,
            customerLastName: curated.customerLastName,
            customerMobile: curated.customerMobile,
            frameNo: curated.frameNo,
            engineNo: curated.engineNo,
            purchaseType: curated.purchaseType,
            totalPayment: curated.totalPayment,
          },
          branchId,
          req.user!._id as unknown as mongoose.Types.ObjectId,
        );

        const count = await SalesReportModel.countDocuments();
        const saleReportId = `SR-${Date.now()}-${String(count + 1).padStart(5, "0")}`;

        await SalesReportModel.create({
          saleReportId,
          rowData: data,
          detectedColumns: parsed.columns,
          sourceFormat: parsed.format,
          modelName: curated.modelName,
          modelVariant: curated.modelVariant,
          customerFirstName: curated.customerFirstName,
          customerLastName: curated.customerLastName,
          customerMobile: curated.customerMobile,
          frameNo: curated.frameNo,
          engineNo: curated.engineNo,
          status: curated.status,
          purchaseType: curated.purchaseType,
          totalPayment: curated.totalPayment,
          matchOutcome: outcome.outcome,
          matched: outcome.matched,
          needsReview: curated.needsReview || outcome.needsReview,
          matchedStockId: outcome.matchedStockId,
          matchedStockType: outcome.matchedStockType,
          customerId: outcome.customerId,
          customerVehicleId: outcome.customerVehicleId,
          importBatch: batchId,
          importDate,
          fileName: file.originalname,
          branchId,
          uploadedBy: req.user!._id,
        });

        results.created.push(saleReportId);
        results.successCount++;
        if (curated.needsReview || outcome.needsReview) results.reviewCount++;
        if (
          outcome.outcome === "matched_status_flipped" ||
          outcome.outcome === "matched_manual_form_status_flipped"
        )
          results.matchedCount++;
        if (outcome.outcome === "unmatched") results.unmatchedCount++;
        if (outcome.outcome === "customer_conflict") results.conflictCount++;
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
      `Sales report imported: ${results.successCount}/${results.totalRows} (batch ${batchId}, branch ${branchId})`,
    );

    if (results.successCount > 0) {
      notify(
        NotificationEvents.salesReportUpload({
          branch: branchId,
          fileName: file.originalname,
          rowCount: results.successCount,
        }),
      ).catch((err) => logger.error(`salesReport notify failed: ${err}`));
    }

    res.status(results.success ? 201 : 207).json({
      success: true,
      message: `Imported ${results.successCount}/${results.totalRows} sales report records`,
      data: results,
    });
  },
);
