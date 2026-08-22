import express from "express";

import {
  incrementVisitorCount,
  getVisitorCount,
  getVisitorStats,
  resetVisitorCount,
} from "../controllers/visitor.controller";
import { protect } from "../middleware/authmiddleware";

const router = express.Router();

// Public routes - for visitor tracking
router.post("/increment-counter", incrementVisitorCount);
router.get("/visitor-count", getVisitorCount);

// Protected routes (Admin only) - for dashboard analytics
router.use(protect);

// Admin dashboard analytics
router.get("/stats", getVisitorStats);
router.post("/reset", resetVisitorCount);

export default router;
