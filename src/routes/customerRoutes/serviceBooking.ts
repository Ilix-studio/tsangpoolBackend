import express from "express";

import { protect, authorize } from "../../middleware/authmiddleware";
import {
  getBranchUpcomingAppointments,
  createServiceBooking,
  getServiceBookings,
  getServiceBookingById,
  updateBookingStatus,
  cancelServiceBooking,
  getBookingStats,
  checkTimeSlotAvailability,
  getCustomerBookings,
  getCustomerServiceStats,
  getCustomerVehicleInfo,
} from "../../controllers/CustomerController/serviceBooking.controller";
import { protectCustomer } from "../../middleware/customerMiddleware";

const router = express.Router();

// Customer routes
router.get("/my-vehicle-info", protectCustomer, getCustomerVehicleInfo);
router.post("/", protectCustomer, createServiceBooking);
router.get("/my-bookings", protectCustomer, getCustomerBookings);
router.get("/my-stats", protectCustomer, getCustomerServiceStats);
router.get("/availability", protectCustomer, checkTimeSlotAvailability);

// Admin routes — MUST be before /:id
router.get(
  "/admin/all",
  protect,
  authorize("Super-Admin", "Service-Admin"),
  getServiceBookings,
);
router.get(
  "/admin/stats",
  protect,
  authorize("Super-Admin", "Service-Admin"),
  getBookingStats,
);
router.patch(
  "/:id/status",
  protect,
  authorize("Super-Admin", "Service-Admin"),
  updateBookingStatus,
);
router.get(
  "/branch/:branchId/upcoming",
  protect,
  authorize("Super-Admin", "Service-Admin"),
  getBranchUpcomingAppointments,
);

// Parameterized routes — LAST
router.get("/:id", protectCustomer, getServiceBookingById);
router.delete("/:id/cancel", protectCustomer, cancelServiceBooking);

export default router;
