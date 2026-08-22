import express from "express";

import {
  saveAuthData,
  loginCustomer,
  registerCustomerByBranchAdmin,
  getNewCustomers,
} from "../../controllers/CustomerController/customer.controller";

import {
  checkPhoneNumber,
  checkPhoneNumbersBatch,
} from "../../controllers/CustomerController/phoneNoCheck.controller";
import {
  validateBatchPhoneCheck,
  validatePhoneCheck,
} from "../../middleware/phoneNoValidation";
import { protect, authorize } from "../../middleware/authmiddleware";

const router = express.Router();

router.post("/save-auth-data", saveAuthData);

router.post(
  "/branch-admin-register",
  protect,
  authorize("Branch-Admin", "Super-Admin", "Service-Admin"),
  registerCustomerByBranchAdmin,
);

router.post("/check-phone", validatePhoneCheck, checkPhoneNumber);
router.post(
  "/check-phones-batch",
  validateBatchPhoneCheck,
  checkPhoneNumbersBatch,
);

router.post("/login", loginCustomer);

router.get("/list", protect, getNewCustomers);

// Add recovery System

export default router;
