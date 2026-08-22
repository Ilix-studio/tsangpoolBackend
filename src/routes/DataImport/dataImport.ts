import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { partsReportConfig, handleMulterError } from "../../config/multerConfig";
import {
  previewImport,
  commitImport,
} from "../../controllers/DataImport/dataImportUpload.controller";
import { getDataImportConfig } from "../../controllers/DataImport/dataImportConfig.controller";
import {
  getDatasets,
  getDatasetRows,
  deleteDataset,
} from "../../controllers/DataImport/dataImportList.controller";

const router = express.Router();

router.use(protect);

// Parse + column-match, no persistence
router.post(
  "/preview",
  partsReportConfig.single("file"),
  handleMulterError,
  previewImport,
);

// Parse, validate, dedup, persist
router.post(
  "/commit",
  partsReportConfig.single("file"),
  handleMulterError,
  commitImport,
);

// Datasets + fields the current role may import
router.get("/config", getDataImportConfig);

// Role/branch-scoped batch + row lists
router.get("/datasets", getDatasets);
router.get("/datasets/:batchId/rows", getDatasetRows);

// Soft delete a batch
router.delete(
  "/datasets/:batchId",
  authorize("Super-Admin", "Branch-Admin"),
  deleteDataset,
);

export default router;
