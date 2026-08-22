import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import {
  getVehicleStats,
  getAllCustomerVehicles,
  deleteVehicle,
  updateServiceStatus,
  getServiceDueVehicles,
  transferVehicle,
  createVehicleFromStock,
  updateVehicle,
  getMyVehicles,
  getVehicleById,
  getVehiclesByPhone,
} from "../../controllers/VASnStock/customerVehicle.controller";
import {
  protectAdminOrCustomer,
  protectCustomer,
} from "../../middleware/customerMiddleware";

const router = express.Router();
// "/api/customer-vehicles"

// ===== CUSTOMER ROUTES (Firebase token required) =====
router.get("/my-vehicles", protectCustomer, getMyVehicles);
router.get("/:id", protectAdminOrCustomer, getVehicleById);

// ===== ADMIN ROUTES (JWT required) =====

// Vehicle CRUD
router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAllCustomerVehicles,
);

router.post(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  createVehicleFromStock,
);

router.put(
  "/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateVehicle,
);

router.delete("/:id", protect, authorize("Super-Admin"), deleteVehicle);

// Service management
router.put(
  "/:id/service-status",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateServiceStatus,
);

router.get(
  "/admin/service-due",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getServiceDueVehicles,
);

// Statistics
router.get(
  "/admin/stats",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getVehicleStats,
);

// Ownership transfer
router.put(
  "/:id/transfer",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  transferVehicle,
);

// Lookup by phone number
router.get(
  "/by-phone/:phone",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getVehiclesByPhone,
);

export default router;
