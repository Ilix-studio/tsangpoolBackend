import express from "express";
import {
  createBike,
  deleteBike,
  getBikeById,
  getBikes,
  getBikesByCategory,
  getBikesByFuelNorms,
  getBikesByMainCategory,
  getE20EfficientBikes,
  searchBikes,
  updateBike,
} from "../../controllers/BikeSystemController/bikes.controller";
import { authorize, protect } from "../../middleware/authmiddleware";

const router = express.Router();

// Public routes (no file uploads needed here)
router.get("/get", getBikes);
router.get("/search", searchBikes);
router.get("/category/:category", getBikesByCategory);
router.get("/main-category/:mainCategory", getBikesByMainCategory);
router.get("/fuel-norms/:fuelNorms", getBikesByFuelNorms);
router.get("/e20-efficient", getE20EfficientBikes);
router.get("/:id", getBikeById);

// Protected routes (Super-Admin only) - NO FILE UPLOADS HERE
// bikes_routes.ts
router.post(
  "/create",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  createBike,
);
router.patch(
  "/:id",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateBike,
);
router.delete("/:id", protect, authorize("Super-Admin"), deleteBike); // delete stays Super-Admin only

export default router;
