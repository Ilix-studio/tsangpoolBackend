import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import {
  counterSaleReportConfig,
  handleMulterError,
} from "../../config/multerConfig";
import { importCounterSaleReport } from "../../controllers/CounterSale/counterSaleUpload.controller";
import {
  getAllCounterSales,
  getCounterSaleById,
  getCounterSaleBatches,
  getCounterSaleBatchesByDate,
} from "../../controllers/CounterSale/counterSaleStats.controller";
import {
  deleteCounterSaleBatch,
  getDeletedCounterSaleBatches,
} from "../../controllers/CounterSale/counterSaleDelete.controller";

const router = express.Router();

router.use(protect);

// Upload a counter sale report (XLSX / CSV) — Part-Admin only
router.post(
  "/import",
  authorize("Part-Admin"),
  counterSaleReportConfig.single("file"),
  handleMulterError,
  importCounterSaleReport,
);

// Reads — Super-Admin (all/?branchId=), Branch-Admin / Part-Admin (own branch)
router.get(
  "/batches",
  authorize("Super-Admin", "Branch-Admin", "Part-Admin"),
  getCounterSaleBatches,
);

// Batches for a single calendar day
router.get(
  "/batches/by-date",
  authorize("Super-Admin", "Branch-Admin", "Part-Admin"),
  getCounterSaleBatchesByDate,
);

// Deleted-batch audit list — Super-Admin only
router.get(
  "/deleted-batches",
  authorize("Super-Admin"),
  getDeletedCounterSaleBatches,
);

// Delete a batch — Super-Admin (any), Branch-Admin / Part-Admin (own branch)
router.delete(
  "/batches/:batchId",
  authorize("Super-Admin", "Branch-Admin", "Part-Admin"),
  deleteCounterSaleBatch,
);

router.get(
  "/:id",
  authorize("Super-Admin", "Branch-Admin", "Part-Admin"),
  getCounterSaleById,
);

// Paginated list — keep last so it doesn't shadow the specific routes above
router.get(
  "/",
  authorize("Super-Admin", "Branch-Admin", "Part-Admin"),
  getAllCounterSales,
);

export default router;
