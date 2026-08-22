// src/routes/getapproved.ts
import express from "express";
import { authorize, protect } from "../../middleware/authmiddleware";

import {
  checkApplicationStatus,
  getApplicationsByBranch,
  submitApplication,
  getAllApplications,
  getApplicationById,
  updateApplicationStatus,
  deleteApplication,
  getApplicationStats,
  submitApplicationWithBike,
  getApplicationsWithBikes,
  updateBikeEnquiry,
  // getBikeRecommendations,
  getEnquiryStats,
} from "../../controllers/CustomerRequest/getapproved.controller";

const router = express.Router();
// "/api/getapproved"

// Public routes - SPECIFIC ROUTES FIRST
router.post("/check-status", checkApplicationStatus);
// two forms
router.post("/with-bike", submitApplicationWithBike);
router.post("/add", submitApplication); // This must come after more specific POST routes

// Protected routes - SPECIFIC ROUTES FIRST
router.get(
  "/stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getApplicationStats,
);

router.get(
  "/enquiry-stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getEnquiryStats,
);

router.get(
  "/with-bikes",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getApplicationsWithBikes,
);

router.get(
  "/all",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAllApplications,
);

// Branch-specific routes
router.get(
  "/branch/:branchId",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getApplicationsByBranch,
);

// Dynamic parameter routes - THESE MUST COME LAST
router.get("/:id", getApplicationById);

router.put(
  "/:id/status",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateApplicationStatus,
);

router.put(
  "/:id/bike-enquiry",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateBikeEnquiry,
);

router.get(
  "/:id/bike-recommendations",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  // getBikeRecommendations
);

// Super-Admin only routes
router.delete("/:id", protect, authorize("Super-Admin"), deleteApplication);

export default router;
