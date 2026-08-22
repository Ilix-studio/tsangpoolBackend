import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { protectCustomer } from "../../middleware/customerMiddleware";
import {
  getInvoiceById,
  listInvoices,
  getMyInvoices,
} from "../../controllers/ServiceM/invoice_controller";

const router = express.Router();

// Customer routes
router.get("/my-invoices", protectCustomer, getMyInvoices);

// Mixed: admin OR customer — both can fetch a single invoice by _id
router.get(
  "/:id",
  (req, res, next) => {
    protect(req, res, (err) => {
      if (err || !req.user) return protectCustomer(req, res, next);
      next();
    });
  },
  getInvoiceById,
);

// Admin-only list
router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  listInvoices,
);

export default router;