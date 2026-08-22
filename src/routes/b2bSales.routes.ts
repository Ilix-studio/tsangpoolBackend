import express from "express";
import { protect, authorize } from "../middleware/authmiddleware";
import {
  createB2BSale,
  deleteB2BSale,
  getB2BSaleById,
  getB2BSalesKPIs,
  listB2BSales,
  searchStockForB2BSale,
  updateB2BSale,
} from "../controllers/b2bSales.controller";

const router = express.Router();

router.use(protect);

// Create a challan — Branch-Admin only.
router.post("/", authorize("Branch-Admin"), createB2BSale);

// Stock search for item selection — Branch-Admin only, own branch.
router.get("/search-stock", authorize("Branch-Admin"), searchStockForB2BSale);

// KPIs — Super-Admin (all/?branchId=), Branch-Admin (own branch). Registered
// before "/:id" so "kpis" isn't swallowed as an id.
router.get("/kpis", authorize("Super-Admin", "Branch-Admin"), getB2BSalesKPIs);

// Paginated list — Super-Admin (all/?branchId=), Branch-Admin (own branch).
router.get("/", authorize("Super-Admin", "Branch-Admin"), listB2BSales);

router.get("/:id", authorize("Super-Admin", "Branch-Admin"), getB2BSaleById);

router.put("/:id", authorize("Super-Admin", "Branch-Admin"), updateB2BSale);

router.delete("/:id", authorize("Super-Admin", "Branch-Admin"), deleteB2BSale);

export default router;
