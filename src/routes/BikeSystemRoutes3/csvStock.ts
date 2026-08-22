// routes/BikeSystemModel2/csvStock.ts

import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";

import { csvUploadConfig, handleMulterError } from "../../config/multerConfig";
import {
  assignCSVStockToCustomer,
  deleteCSVBatch,
  deleteCSVStock,
  getCSVBatches,
  getCSVBatchesByDate,
  getCSVStockByStockId,
  getCSVStocks,
  getAssignedCSVStockWithCustomers,
  getStocksByBatch,
  importCSVStock,
  unassignCSVStock,
  updateCSVStockStatus,
} from "../../controllers/VASnStock/csvStockImport.controller";
import { getStockBatchReports } from "../../controllers/VASnStock/stockBatchReport.controller";
import { getStockInvestmentTimeseries } from "../../controllers/VASnStock/stockInvestmentTimeseries.controller";
import { getCSVStockAssignStats } from "../../controllers/VASnStock/AssignToCustomer/StockAssign";

const router = express.Router();

router.post(
  "/import",
  protect,
  authorize("Branch-Admin"),
  csvUploadConfig.single("file"),
  handleMulterError,
  importCSVStock,
);

router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getCSVStocks,
);
//

router.post(
  "/assign/:stockId",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  assignCSVStockToCustomer,
);
// Batch-level investment/revenue report — must be registered before the
// generic /:stockId route below, otherwise it'd be swallowed as a stockId.
router.get(
  "/batch-reports",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getStockBatchReports,
);
// Daily/weekly/monthly/yearly cost-price investment trend — same reason as
// batch-reports above for being registered before the generic /:stockId.
router.get(
  "/investment/timeseries",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getStockInvestmentTimeseries,
);

router.get(
  "/assign-stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getCSVStockAssignStats,
);
// Assigned CSV stock + buyer profiles for the Sales Report screen. Literal
// path, so it must stay above the generic /:stockId below — see CLAUDE.md.
router.get(
  "/assigned",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAssignedCSVStockWithCustomers,
);
//
router.get(
  "/:stockId",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  getCSVStockByStockId,
);

// Get CSV import batches
router.get(
  "/batches/list",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  getCSVBatches,
);

// Get CSV import batches for a single calendar day
router.get(
  "/batches/by-date",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  getCSVBatchesByDate,
);

// Get stocks by batch ID
router.get(
  "/batch/:batchId",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  getStocksByBatch,
);

// Delete an entire CSV batch/folder (soft delete). Branch-Admin is scoped to
// its own branch; Super-Admin may delete any batch.
router.delete(
  "/batch/:batchId",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  deleteCSVBatch,
);

// Update CSV stock status
router.patch(
  "/:stockId/status",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  updateCSVStockStatus,
);
router.post(
  "/unassign/:stockId",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  unassignCSVStock,
);

// Delete CSV stock (soft delete)
router.delete("/:stockId", protect, authorize("Super-Admin"), deleteCSVStock);

export default router;
