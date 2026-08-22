import express from "express";
import {
  deleteAllBikeImages,
  deleteBikeImage,
  getBikeImages,
  getPrimaryImageByModelName,
  setPrimaryImage,
  updateBikeImage,
  uploadBikeImages,
  uploadSingleBikeImage,
} from "../../controllers/BikeSystemController/bikeImage.controller";
import { authorize, protect } from "../../middleware/authmiddleware";
import { bikeUploadConfig, handleMulterError } from "../../config/multerConfig";

const router = express.Router();

// Public routes
router.get("/:bikeId", getBikeImages);

// Protected routes (Super-Admin only) - FILE UPLOADS HERE
router.post(
  "/:bikeId",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  bikeUploadConfig.array("images", 10),
  handleMulterError,
  uploadBikeImages,
);

router.post(
  "/:bikeId/single",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  bikeUploadConfig.single("image"),
  handleMulterError,
  uploadSingleBikeImage,
);

router.patch(
  "/image/:imageId",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  updateBikeImage,
);

router.delete(
  "/image/:imageId",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  deleteBikeImage,
);

router.delete(
  "/:bikeId",
  protect,
  authorize("Super-Admin"), // bulk delete stays Super-Admin only
  deleteAllBikeImages,
);

router.put(
  "/:bikeId/primary/:imageId",
  protect,
  authorize("Super-Admin", "Branch-Admin"),
  setPrimaryImage,
);
router.get("/by-model/:modelName", getPrimaryImageByModelName);

export default router;
