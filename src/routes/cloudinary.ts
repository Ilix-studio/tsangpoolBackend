import express from "express";

import {
  deleteCloudinaryImage,
  generateSignature,
} from "../controllers/cloudinaryController";
import { protect } from "../middleware/authmiddleware";

const router = express.Router();

// Protect all routes
router.use(protect);

// Routes
router.post("/signature", generateSignature);
router.delete("/:publicId", deleteCloudinaryImage);

export default router;
