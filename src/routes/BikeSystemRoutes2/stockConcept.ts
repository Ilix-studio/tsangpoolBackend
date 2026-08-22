import express from "express";
import { authorize, protect } from "../../middleware/authmiddleware";
import {
  createStockItem,
  getAllStockItems,
  getAssignedStockWithCustomers,
  getMyVehicles,
  getStockItemById,
  getVehicleById,
} from "../../controllers/VASnStock/stockConcept.controller";
import { activateToCustomer } from "../../controllers/VASnStock/AssignToCustomer/StockAssign";
import { getStockAssignStats } from "../../controllers/VASnStock/AssignToCustomer/assignStats.controller";
import { getStockStatusSummary } from "../../controllers/VASnStock/stockStatusSummary.controller";
import {
  protectAdminOrCustomer,
  protectCustomer,
} from "../../middleware/customerMiddleware";



const router = express.Router();

// Static routes first
router.get("/my-vehicles", protectCustomer, getMyVehicles);

router.get(
  "/assigned",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAssignedStockWithCustomers
);

router.get(
  "/status-summary",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getStockStatusSummary,
);

router.get(
  "/assign-stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getStockAssignStats
);

router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAllStockItems
);

router.post(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  createStockItem
);

// Dynamic :id routes last
router.post(
  "/:id/activate",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  activateToCustomer
);

router.get("/:id", protectAdminOrCustomer, getVehicleById);

router.get(
  "/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getStockItemById
);

export default router;