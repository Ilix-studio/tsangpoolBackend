import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { ImportedDatasetModel } from "../../models/DataImport/ImportedDataset";
import { ImportedRowModel } from "../../models/DataImport/ImportedRow";
import {
  getDatasetDefinition,
  isDatasetType,
  DatasetType,
} from "../../models/DataImport/datasetRegistry";
import {
  matchColumns,
  buildNormalizedRow,
} from "../../utils/dataImport/columnMatcher";
import { parseDataImportFile, computeRowHash } from "../../service/dataImport.service";
import { getUserBranch, getUserRole, isAdmin } from "../../types/user.types";
import logger from "../../utils/logger";

/**
 * Resolve which branch this upload/query belongs to.
 * - Super-Admin: must pass a branchId (body or query).
 * - Branch-scoped roles: always their own branch.
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

function resolveDatasetAccess(req: Request, datasetType: DatasetType): boolean {
  if (!req.user) return false;
  const role = getUserRole(req.user);
  return getDatasetDefinition(datasetType).allowedRoles.includes(role);
}

/**
 * @desc    Parse + column-match an uploaded file, no persistence.
 * @route   POST /api/data-import/preview
 * @access  Any authenticated role allowed for the given datasetType
 */
export const previewImport = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400);
      throw new Error("File required");
    }

    const datasetType = req.body?.datasetType as string;
    if (!datasetType || !isDatasetType(datasetType)) {
      res.status(400);
      throw new Error("Valid datasetType required");
    }

    if (!resolveDatasetAccess(req, datasetType)) {
      res.status(403);
      throw new Error("Not authorized to import this dataset type");
    }

    const sheetName = (req.body?.sheetName as string) || undefined;
    const parsed = await parseDataImportFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      { sheetName },
    );

    const dataset = getDatasetDefinition(datasetType);
    const matchResult = matchColumns(parsed.columns, dataset);

    res.status(200).json({
      success: true,
      data: {
        format: parsed.format,
        columns: parsed.columns,
        sheetNames: parsed.sheetNames,
        sheetUsed: parsed.sheetUsed,
        totalRows: parsed.rows.length,
        sampleRows: parsed.rows.slice(0, 20).map((r) => r.data),
        matchedFields: matchResult.matchedFields,
        unmatchedColumns: matchResult.unmatchedColumns,
        missingRequired: matchResult.missingRequired,
        isValid: matchResult.isValid,
      },
    });
  },
);

/**
 * @desc    Parse, validate, dedup, and persist an uploaded file.
 * @route   POST /api/data-import/commit
 * @access  Any authenticated role allowed for the given datasetType
 */
export const commitImport = asyncHandler(
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400);
      throw new Error("File required");
    }

    const datasetType = req.body?.datasetType as string;
    if (!datasetType || !isDatasetType(datasetType)) {
      res.status(400);
      throw new Error("Valid datasetType required");
    }

    if (!resolveDatasetAccess(req, datasetType)) {
      res.status(403);
      throw new Error("Not authorized to import this dataset type");
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

    const sheetName = (req.body?.sheetName as string) || undefined;
    const parsed = await parseDataImportFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      { sheetName },
    );

    if (parsed.rows.length === 0) {
      res.status(400);
      throw new Error("No rows could be extracted from the file");
    }

    const dataset = getDatasetDefinition(datasetType);
    const matchResult = matchColumns(parsed.columns, dataset);

    if (!matchResult.isValid) {
      res.status(400);
      throw new Error(
        `Missing required columns: ${matchResult.missingRequired.join(", ")}`,
      );
    }

    const batchId = `DI-${datasetType}-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const importedDataset = await ImportedDatasetModel.create({
      batchId,
      datasetType,
      fileName: file.originalname,
      sourceFormat: parsed.format,
      sheetUsed: parsed.sheetUsed,
      availableSheets: parsed.sheetNames,
      detectedColumns: parsed.columns,
      matchedFields: matchResult.matchedFields,
      unmatchedColumns: matchResult.unmatchedColumns,
      missingRequired: matchResult.missingRequired,
      totalRows: parsed.rows.length,
      branchId,
      uploadedBy: req.user!._id,
      uploadedByRole: getUserRole(req.user!),
    });

    const results = {
      success: false,
      totalRows: parsed.rows.length,
      importedRows: 0,
      duplicateRows: 0,
      reviewRows: 0,
      batchId,
      sourceFormat: parsed.format,
      sheetUsed: parsed.sheetUsed,
      detectedColumns: parsed.columns,
      errors: [] as { row: number; data: Record<string, any>; error: string }[],
    };

    for (let i = 0; i < parsed.rows.length; i++) {
      const { data, needsReview: parseNeedsReview } = parsed.rows[i];
      const rowNumber = i + 2; // header is row 1

      try {
        const rowHash = computeRowHash(data);

        const existing = await ImportedRowModel.findOne({
          branchId,
          datasetType,
          rowHash,
          isActive: true,
        });
        if (existing) {
          results.duplicateRows++;
          continue;
        }

        const { normalized, needsReview: normalizeNeedsReview } =
          buildNormalizedRow(data, matchResult, datasetType);

        if (datasetType === "vehicle-stock" && parsed.sheetUsed) {
          normalized.sourceSheet = parsed.sheetUsed;
        }

        const needsReview = parseNeedsReview || normalizeNeedsReview;
        const rowId = `DIROW-${Date.now()}-${String(i + 1).padStart(6, "0")}`;

        await ImportedRowModel.create({
          rowId,
          dataset: importedDataset._id,
          batchId,
          datasetType,
          rowData: data,
          normalized,
          rowHash,
          sourceFormat: parsed.format,
          needsReview,
          branchId,
          uploadedBy: req.user!._id,
        });

        results.importedRows++;
        if (needsReview) results.reviewRows++;
      } catch (error) {
        results.errors.push({
          row: rowNumber,
          data,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    results.success = results.errors.length === 0;

    const status = results.errors.length === 0 ? "completed" : "completed_with_errors";
    await ImportedDatasetModel.findByIdAndUpdate(importedDataset._id, {
      importedRows: results.importedRows,
      duplicateRows: results.duplicateRows,
      reviewRows: results.reviewRows,
      status,
    });

    logger.info(
      `DataImport committed: ${results.importedRows}/${results.totalRows} (batch ${batchId}, dataset ${datasetType}, branch ${branchId})`,
    );

    res.status(results.success ? 201 : 207).json({
      success: true,
      message: `Imported ${results.importedRows}/${results.totalRows} rows`,
      data: results,
    });
  },
);
