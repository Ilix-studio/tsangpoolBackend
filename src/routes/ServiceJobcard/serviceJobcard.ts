import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { partsReportConfig, handleMulterError } from "../../config/multerConfig";
import {
  importServiceJobcardReport,
  rerunServiceJobcardRegistration,
} from "../../controllers/ServiceJobcard/serviceJobcardUpload.controller";
import { deleteServiceJobcardBatch } from "../../controllers/ServiceJobcard/serviceJobcardDelete.controller";
import {
  getServiceJobcardStats,
  getAllServiceJobcards,
  getServiceJobcardsByDate,
  getServiceJobcardBatches,
  getServiceJobcardBatchesByDate,
  getServiceJobcardStatus,
} from "../../controllers/ServiceJobcard/serviceJobcardStats.controller";
import { getSalesTimeseries } from "../../controllers/ServiceJobcard/serviceJobcardSalesTimeseries.controller";

const router = express.Router();

router.use(protect);

// Upload a service-jobcard report (XLSX)
router.post(
  "/import",
  authorize("Service-Admin", "Super-Admin"),
  partsReportConfig.single("file"),
  handleMulterError,
  importServiceJobcardReport,
);

// Stats + lists (Service-Admin scoped to own branch; Super-Admin all or ?branchId=)
router.get("/stats", authorize("Service-Admin", "Super-Admin"), getServiceJobcardStats);
router.get("/by-date", authorize("Service-Admin", "Super-Admin"), getServiceJobcardsByDate);
router.get("/batches", authorize("Service-Admin", "Super-Admin"), getServiceJobcardBatches);
router.get(
  "/batches/by-date",
  authorize("Service-Admin", "Super-Admin"),
  getServiceJobcardBatchesByDate,
);
router.post(
  "/batches/:batchId/rerun-registration",
  authorize("Service-Admin", "Super-Admin"),
  rerunServiceJobcardRegistration,
);
router.delete(
  "/batches/:batchId",
  authorize("Service-Admin", "Super-Admin"),
  deleteServiceJobcardBatch,
);
router.get(
  "/stock-status",
  authorize("Service-Admin", "Super-Admin"),
  getServiceJobcardStatus,
);
router.get("/sales/timeseries", authorize("Service-Admin", "Super-Admin"), getSalesTimeseries);

// Paginated list — keep last so it doesn't shadow the specific routes above
router.get("/", authorize("Service-Admin", "Super-Admin"), getAllServiceJobcards);

export default router;
