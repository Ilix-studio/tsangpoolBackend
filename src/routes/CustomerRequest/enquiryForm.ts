// routes/enquiry.routes.ts
import express from "express";
import { authorize, protect } from "../../middleware/authmiddleware";
import {
  createEnquiry,
  deleteEnquiry,
  getAllEnquiries,
  getEnquiryById,
  getEnquiryStats,
} from "../../controllers/CustomerRequest/enquiry.controller";

const router = express.Router();

// Public routes
router.post("/", createEnquiry);

// Protected routes - Admin access required
router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAllEnquiries,
);

router.get(
  "/stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getEnquiryStats,
);

router.get(
  "/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getEnquiryById,
);

// Super-Admin only routes
router.delete("/:id", protect, authorize("Super-Admin"), deleteEnquiry);

export default router;
