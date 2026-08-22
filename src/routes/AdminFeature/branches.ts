import express from "express";

import { authorize, protect } from "../../middleware/authmiddleware";
import {
  addBranch,
  deleteBranch,
  getBranchById,
  getBranches,
  updateBranch,
} from "../../controllers/branches.controller";

const router = express.Router();
// "/api/branch"

// Public routes
router.get("/", getBranches);
router.get("/:id", getBranchById);

// Protected routes - Super-Admin only
router.post("/", protect, authorize("Super-Admin"), addBranch);
router.patch("/:id", protect, authorize("Super-Admin"), updateBranch);
router.delete("/:id", protect, authorize("Super-Admin"), deleteBranch);

export default router;
