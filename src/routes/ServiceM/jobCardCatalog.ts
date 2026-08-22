import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import {
  createCatalogItem,
  listCatalogItems,
  updateCatalogItem,
  deleteCatalogItem,
} from "../../controllers/ServiceM/jobCardCatalog.controller";

const router = express.Router();

// All routes require authentication
router.use(protect);

router.post("/", authorize("Service-Admin", "Branch-Admin"), createCatalogItem);

router.get(
  "/",
  authorize("Super-Admin", "Branch-Admin", "Service-Admin"),
  listCatalogItems,
);

router.patch(
  "/:id",
  authorize("Service-Admin", "Branch-Admin"),
  updateCatalogItem,
);

router.delete(
  "/:id",
  authorize("Super-Admin", "Branch-Admin"),
  deleteCatalogItem,
);

export default router;
