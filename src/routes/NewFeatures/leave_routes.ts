// routes/leave_routes.ts
import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";

import {
  cancelLeave,
  applyLeave,
  getMyLeaves,
  getLeaveBalance,
  reviewLeave,
  getAllLeaves,
} from "../../controllers/NewFeatures/leave_controller";

const router = express.Router();

router.use(protect);

// Applicant routes
router.post(
  "/apply",
  authorize("Branch-Admin", "Service-Admin", "Part-Admin", "Staff"),
  applyLeave,
);
router.get(
  "/my",
  authorize("Branch-Admin", "Service-Admin", "Part-Admin", "Staff"),
  getMyLeaves,
);
router.get(
  "/balance",
  authorize("Branch-Admin", "Service-Admin", "Part-Admin", "Staff"),
  getLeaveBalance,
);
router.patch(
  "/:id/cancel",
  authorize("Branch-Admin", "Service-Admin", "Part-Admin", "Staff"),
  cancelLeave,
);

// Super-Admin routes
router.get("/", authorize("Super-Admin"), getAllLeaves);
router.patch("/:id/review", authorize("Super-Admin"), reviewLeave);

export default router;
