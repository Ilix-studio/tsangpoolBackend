import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import {
  salesReportConfig,
  handleMulterError,
} from "../../config/multerConfig";
import { importSalesReport } from "../../controllers/SalesReport/salesReportUpload.controller";
import {
  getAllSalesReports,
  getSalesReportById,
  getSalesReportBatches,
  getSalesReportBatchesByDate,
  getSalesReportKpis,
} from "../../controllers/SalesReport/salesReportStats.controller";
import {
  deleteSalesReportBatch,
  getDeletedSalesReportBatches,
} from "../../controllers/SalesReport/salesReportDelete.controller";

const router = express.Router();

router.use(protect);

// Upload a sales report (of already-sold vehicles) — Branch-Admin only
router.post(
  "/import",
  authorize("Branch-Admin"),
  salesReportConfig.single("file"),
  handleMulterError,
  importSalesReport,
);

// Reads — Super-Admin (all/?branchId=), Branch-Admin (own branch)
router.get(
  "/batches",
  authorize("Super-Admin", "Branch-Admin"),
  getSalesReportBatches,
);

// Batches for a single calendar day
router.get(
  "/batches/by-date",
  authorize("Super-Admin", "Branch-Admin"),
  getSalesReportBatchesByDate,
);

// Deleted-batch audit list — Super-Admin only
router.get(
  "/deleted-batches",
  authorize("Super-Admin"),
  getDeletedSalesReportBatches,
);

// Delete a batch — Super-Admin (any), Branch-Admin (own branch)
router.delete(
  "/batches/:batchId",
  authorize("Super-Admin", "Branch-Admin"),
  deleteSalesReportBatch,
);

// KPIs — Super-Admin only
router.get(
  "/kpis",
  authorize("Super-Admin", "Branch-Admin"),
  getSalesReportKpis,
);

router.get(
  "/:id",
  authorize("Super-Admin", "Branch-Admin"),
  getSalesReportById,
);

// Paginated list — keep last so it doesn't shadow the specific routes above
router.get(
  "/",
  authorize("Super-Admin", "Branch-Admin"),
  getAllSalesReports,
);

export default router;
