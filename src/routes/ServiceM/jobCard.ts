import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { protectCustomer } from "../../middleware/customerMiddleware";
import {
  createJobCard,
  listJobCards,
  getJobCard,
  addLineItem,
  removeLineItem,
  sendTempBill,
  customerReview,
  acknowledgeReview,
  sendFinalBill,
  requestConfirmationOtp,
  verifyConfirmationOtp,
  confirmViaButton,
  getInvoice,
  cancelJobCard,
  getRevenueStats,
  getJobCardStatusStats,
} from "../../controllers/ServiceM/jobCard.controller";

const router = express.Router();

// ─── Admin routes (JWT) ───────────────────────────────────────────────────────

router.post("/", protect, authorize("Service-Admin"), createJobCard);

router.get(
  "/",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  listJobCards,
);

router.post(
  "/:id/line-items",
  protect,
  authorize("Service-Admin"),
  addLineItem,
);

router.delete(
  "/:id/line-items/:itemId",
  protect,
  authorize("Service-Admin"),
  removeLineItem,
);

router.patch(
  "/:id/send-temp-bill",
  protect,
  authorize("Service-Admin"),
  sendTempBill,
);

router.patch(
  "/:id/acknowledge",
  protect,
  authorize("Service-Admin"),
  acknowledgeReview,
);

router.patch(
  "/:id/send-final-bill",
  protect,
  authorize("Service-Admin"),
  sendFinalBill,
);
router.get(
  "/stats/revenue",
  protect,
  authorize("Super-Admin"),
  getRevenueStats,
);

router.get(
  "/stats/status",
  protect,
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  getJobCardStatusStats,
);

router.delete("/:id", protect, authorize("Service-Admin"), cancelJobCard);

// ─── Mixed access: admin OR customer ─────────────────────────────────────────
// getJobCard and getInvoice check req.user vs req.customer internally.
// We run both middleware but neither throws if the other succeeds.

router.get(
  "/:id",
  (req, res, next) => {
    // Try admin token first; if it fails, fall through to customer middleware
    protect(req, res, (err) => {
      if (err || !req.user) {
        return protectCustomer(req, res, next);
      }
      next();
    });
  },
  getJobCard,
);

router.get(
  "/:id/invoice",
  (req, res, next) => {
    protect(req, res, (err) => {
      if (err || !req.user) {
        return protectCustomer(req, res, next);
      }
      next();
    });
  },
  getInvoice,
);

// ─── Customer routes (Firebase) ───────────────────────────────────────────────

router.patch("/:id/customer-review", protectCustomer, customerReview);

router.post(
  "/:id/confirm/request-otp",
  protectCustomer,
  requestConfirmationOtp,
);

router.post("/:id/confirm/verify-otp", protectCustomer, verifyConfirmationOtp);

router.post("/:id/confirm/button", protectCustomer, confirmViaButton);

export default router;
