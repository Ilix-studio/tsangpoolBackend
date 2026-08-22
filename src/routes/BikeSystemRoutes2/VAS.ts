import express from "express";
import {
  createValueAddedService,
  getAllValueAddedServices,
  getValueAddedServiceById,
  updateValueAddedService,
  deleteValueAddedService,
  calculateServicePrice,
  getCustomerActiveServices,
  getServicesByType,
  getCustomersWithActiveVAS,
  debugVASData,
} from "../../controllers/VASnStock/vas.controller";
import { authorize, protect } from "../../middleware/authmiddleware";
import { protectCustomer } from "../../middleware/customerMiddleware";
import { activateCustomerService } from "../../controllers/VASnStock/AssignToCustomer/vasAssign";
import {
  getCombinedVasAssignStats,
  getVasAssignStats,
} from "../../controllers/VASnStock/AssignToCustomer/assignStats.controller";

const router = express.Router();
// "/api/value-added-services"

// ===== ADMIN ROUTES =====
router.post(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  createValueAddedService,
);

router.get(
  "/admin",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Staff"),
  getAllValueAddedServices,
);

router.get(
  "/admin/customers",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getCustomersWithActiveVAS,
);

router.get(
  "/assign-stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getVasAssignStats,
);

router.get(
  "/vas-assign-stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getCombinedVasAssignStats,
);

router.get(
  "/admin/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Staff"),
  getValueAddedServiceById,
);

router.patch(
  "/admin/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateValueAddedService,
);

router.delete(
  "/admin/:id",
  protect,
  authorize("Super-Admin"),
  deleteValueAddedService,
);

// Customer service activation (Admin triggers this)
router.post(
  "/activate",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  activateCustomerService,
);

// ===== CUSTOMER ROUTES =====
router.get("/my-services", protectCustomer, getCustomerActiveServices);
router.post("/calculate-price", protectCustomer, calculateServicePrice);

// ===== PUBLIC/MIXED ROUTES =====
router.get("/debug", debugVASData);
router.get("/types/:serviceType", getServicesByType);

export default router;
