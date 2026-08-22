import express from "express";
import {
  protectAdminOrCustomer,
  protectCustomer,
} from "../../middleware/customerMiddleware";
import { authorize, protect } from "../../middleware/authmiddleware";
import {
  getCustomerProfile,
  createProfile,
  updateCustomerProfile,
  getAllCustomers,
  getCustomerById,
} from "../../controllers/CustomerController/profile.controller";

const router = express.Router();
// "/api/customer-profile"

// ===== CUSTOMER ROUTES (Firebase token required) =====
router.post("/create", protectCustomer, createProfile);
router.get("/get", protectCustomer, getCustomerProfile);
router.patch("/update", protectCustomer, updateCustomerProfile);

// Customer can access their own data, admin can access any
router.get("/:customerId", protectAdminOrCustomer, getCustomerById);

// ===== ADMIN ROUTES (JWT required) =====
router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  getAllCustomers,
);

router.delete("/:customerId", protect, authorize("Super-Admin"));

export default router;
