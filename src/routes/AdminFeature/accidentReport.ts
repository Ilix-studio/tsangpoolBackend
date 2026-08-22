// routes/accidentReport.routes.ts
import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { protectCustomer } from "../../middleware/customerMiddleware";

import {
  createAccidentReport,
  getMyAccidentReports,
  getMyAccidentReportById,
  getAllAccidentReports,
  getAccidentReportById,
  downloadAccidentReportsCSV,
  updateReportStatus,
} from "../../controllers/AdminFeature/accidentReport.controller";

const router = express.Router();
// Mounted at: /api/accident-reports

// ─── CUSTOMER (Firebase token) ────────────────────────────────────────────────
router.post("/", protectCustomer, createAccidentReport);
router.get("/my-reports", protectCustomer, getMyAccidentReports);
router.get("/my-reports/:id", protectCustomer, getMyAccidentReportById);

// ─── ADMIN (JWT token) ────────────────────────────────────────────────────────
router.get(
  "/download",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  downloadAccidentReportsCSV
);

router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAllAccidentReports
);

router.get(
  "/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAccidentReportById
);

router.patch(
  "/:id/status",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateReportStatus
);

export default router;
