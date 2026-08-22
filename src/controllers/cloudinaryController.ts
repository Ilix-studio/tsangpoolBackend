// src/controllers/cloudinaryController.ts
import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import cloudinary from "../config/cloudinaryConfig";
import logger from "../utils/logger";

/**
 * Generate a signature for authenticated Cloudinary uploads
 * @route POST /api/cloudinary/signature
 * @access Private (Admin only)
 */
export const generateSignature = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { folder = "honda-golaghat-dealer" } = req.body;

      // Check if Cloudinary env variables are properly set
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;

      if (!cloudName || !apiKey || !apiSecret) {
        res.status(500).json({
          success: false,
          message: "Cloudinary configuration is missing on the server",
        });
        return; // Return without the response object
      }

      // Create timestamp for the signature
      const timestamp = Math.round(new Date().getTime() / 1000);

      // Create the signature
      const signature = cloudinary.utils.api_sign_request(
        { timestamp, folder },
        apiSecret,
      );

      // Return signature data to the client
      res.status(200).json({
        timestamp,
        signature,
        cloudName,
        apiKey,
        folder,
      });
    } catch (error: any) {
      logger.error(`Error generating Cloudinary signature: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Error generating upload signature",
        error: error.message,
      });
    }
  },
);

/**
 * Delete an image from Cloudinary
 * @route DELETE /api/cloudinary/:publicId
 * @access Private (Admin only)
 */
export const deleteCloudinaryImage = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { publicId } = req.params;

      if (!publicId) {
        res.status(400);
        throw new Error("Public ID is required");
      }

      // Delete the image from Cloudinary
      const result = await cloudinary.uploader.destroy(publicId);

      if (result.result !== "ok") {
        res.status(400);
        throw new Error(`Failed to delete image: ${result.result}`);
      }

      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error: any) {
      logger.error(`Error deleting Cloudinary image: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Error deleting image",
        error: error.message,
      });
    }
  },
);
