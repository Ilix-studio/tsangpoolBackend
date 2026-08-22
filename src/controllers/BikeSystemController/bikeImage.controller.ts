// controllers/bikeImage.controller.ts
import asyncHandler from "express-async-handler";
import { v2 as cloudinary } from "cloudinary";
import { Request, Response } from "express";
import BikeModel from "../../models/BikeSystemModel/Bikes";
import BikeImageModel from "../../models/BikeSystemModel/BikeImageModel";
import { deleteFromCloudinary } from "../../utils/cloudinaryHelper";

/**
 * @desc    Upload images for a bike
 * @route   POST /api/bike-images/:bikeId
 * @access  Private/Super-Admin, Branch-Admin
 */
export const uploadBikeImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { bikeId } = req.params;
    const { altTexts } = req.body;

    // Validate bike exists
    const bike = await BikeModel.findById(bikeId);
    if (!bike) {
      res.status(404);
      throw new Error("Bike not found");
    }

    // Check if files are uploaded
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({
        success: false,
        error: "At least one image is required",
      });
      return;
    }

    const files = req.files as Express.Multer.File[];

    try {
      // Parse altTexts
      let altTextsArray: string[] = [];
      if (typeof altTexts === "string") {
        try {
          altTextsArray = JSON.parse(altTexts);
        } catch (error) {
          altTextsArray = [altTexts];
        }
      } else if (Array.isArray(altTexts)) {
        altTextsArray = altTexts;
      }

      // Check if this is the first image for this bike
      const existingImages = await BikeImageModel.find({
        bikeId,
        isActive: true,
      });
      const isFirstImage = existingImages.length === 0;

      // Upload all images to Cloudinary
      const uploadPromises = files.map((file, index) => {
        return new Promise((resolve, reject) => {
          cloudinary.uploader
            .upload_stream(
              {
                folder: `honda-golaghat-dealer/${bike.mainCategory}s`,
                resource_type: "image",
                quality: "auto",
                format: "jpg",
                transformation: [
                  { width: 800, height: 600, crop: "fill" },
                  { quality: "auto" },
                ],
              },
              (error, result) => {
                if (error) reject(error);
                else
                  resolve({
                    src: result!.secure_url,
                    alt:
                      altTextsArray[index] ||
                      `${bike.modelName} - Image ${
                        existingImages.length + index + 1
                      }`,
                    cloudinaryPublicId: result!.public_id,
                    isPrimary: isFirstImage && index === 0, // First image is primary only if no existing images
                  });
              },
            )
            .end(file.buffer);
        });
      });

      const uploadedImageData = await Promise.all(uploadPromises);

      // Create image documents
      const imageDocuments = uploadedImageData.map((imageData: any) => ({
        bikeId,
        ...imageData,
      }));

      const savedImages = await BikeImageModel.insertMany(imageDocuments);

      res.status(201).json({
        success: true,
        message: `${uploadedImageData.length} image(s) uploaded successfully for ${bike.modelName}`,
        data: {
          bikeId,
          uploadedCount: savedImages.length,
          images: savedImages,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to upload images",
      });
    }
  },
);

/**
 * @desc    Get all images for a bike
 * @route   GET /api/bike-images/:bikeId
 * @access  Public
 */
export const getBikeImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { bikeId } = req.params;

    // Validate bike exists
    const bike = await BikeModel.findById(bikeId);
    if (!bike) {
      res.status(404);
      throw new Error("Bike not found");
    }

    const images = await BikeImageModel.find({
      bikeId,
      isActive: true,
    })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        bikeId,
        bike: {
          modelName: bike.modelName,
          mainCategory: bike.mainCategory,
        },
        images,
        count: images.length,
      },
    });
  },
);

/**
 * @desc    Update image details (alt text, set as primary)
 * @route   PUT /api/bike-images/image/:imageId
 * @access  Private/Super-Admin, Branch-Admin
 */
export const updateBikeImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { imageId } = req.params;
    const { alt, isPrimary } = req.body;

    const image = await BikeImageModel.findById(imageId);
    if (!image) {
      res.status(404);
      throw new Error("Image not found");
    }

    // If setting as primary, unset other primary images for this bike
    if (isPrimary === true) {
      await BikeImageModel.updateMany(
        { bikeId: image.bikeId, _id: { $ne: imageId } },
        { isPrimary: false },
      );
    }

    // Update image
    if (alt !== undefined) image.alt = alt;
    if (isPrimary !== undefined) image.isPrimary = isPrimary;

    const updatedImage = await image.save();

    res.status(200).json({
      success: true,
      message: "Image updated successfully",
      data: updatedImage,
    });
  },
);

/**
 * @desc    Delete a specific bike image
 * @route   DELETE /api/bike-images/image/:imageId
 * @access  Private/Super-Admin, Branch-Admin
 */
export const deleteBikeImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { imageId } = req.params;

    const image = await BikeImageModel.findById(imageId);
    if (!image) {
      res.status(404);
      throw new Error("Image not found");
    }

    try {
      // Delete from Cloudinary
      await deleteFromCloudinary(image.src);

      // Delete from database
      await BikeImageModel.findByIdAndDelete(imageId);

      // If this was the primary image, set another image as primary
      if (image.isPrimary) {
        const nextImage = await BikeImageModel.findOne({
          bikeId: image.bikeId,
          isActive: true,
        }).sort({ createdAt: 1 });

        if (nextImage) {
          nextImage.isPrimary = true;
          await nextImage.save();
        }
      }

      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to delete image",
      });
    }
  },
);

/**
 * @desc    Delete all images for a bike
 * @route   DELETE /api/bike-images/:bikeId
 * @access  Private/Super-Admin
 */
export const deleteAllBikeImages = asyncHandler(
  async (req: Request, res: Response) => {
    const { bikeId } = req.params;

    const bike = await BikeModel.findById(bikeId);
    if (!bike) {
      res.status(404);
      throw new Error("Bike not found");
    }

    const images = await BikeImageModel.find({ bikeId, isActive: true });

    if (images.length === 0) {
      res.status(400).json({
        success: false,
        error: "No images found for this bike",
      });
      return;
    }

    try {
      // Delete all images from Cloudinary
      const deletePromises = images.map((image) =>
        deleteFromCloudinary(image.src),
      );
      await Promise.all(deletePromises);

      // Delete from database
      await BikeImageModel.deleteMany({ bikeId });

      res.status(200).json({
        success: true,
        message: `${images.length} images deleted successfully for ${bike.modelName}`,
        deletedCount: images.length,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to delete images",
      });
    }
  },
);

/**
 * @desc    Set primary image for a bike
 * @route   PUT /api/bike-images/:bikeId/primary/:imageId
 * @access  Private/Super-Admin, Branch-Admin
 */
export const setPrimaryImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { bikeId, imageId } = req.params;

    const bike = await BikeModel.findById(bikeId);
    if (!bike) {
      res.status(404);
      throw new Error("Bike not found");
    }

    const image = await BikeImageModel.findOne({
      _id: imageId,
      bikeId,
      isActive: true,
    });

    if (!image) {
      res.status(404);
      throw new Error("Image not found for this bike");
    }

    // Unset all primary images for this bike
    await BikeImageModel.updateMany({ bikeId }, { isPrimary: false });

    // Set this image as primary
    image.isPrimary = true;
    await image.save();

    res.status(200).json({
      success: true,
      message: "Primary image updated successfully",
      data: image,
    });
  },
);

/**
 * @desc    Upload single image for a bike
 * @route   POST /api/bike-images/:bikeId/single
 * @access  Private/Super-Admin, Branch-Admin
 */
export const uploadSingleBikeImage = asyncHandler(
  async (req: Request, res: Response) => {
    const { bikeId } = req.params;
    const { alt } = req.body;

    // Validate bike exists
    const bike = await BikeModel.findById(bikeId);
    if (!bike) {
      res.status(404);
      throw new Error("Bike not found");
    }

    // Check if file is uploaded
    const imageFile = req.file;
    if (!imageFile) {
      res.status(400).json({
        success: false,
        error: "Image file is required",
      });
      return;
    }

    try {
      // Check if this is the first image for this bike
      const existingImagesCount = await BikeImageModel.countDocuments({
        bikeId,
        isActive: true,
      });
      const isFirstImage = existingImagesCount === 0;

      // Upload image to Cloudinary
      const imageUploadResult = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: `honda-golaghat-dealer/${bike.mainCategory}s`,
              resource_type: "image",
              quality: "auto",
              format: "jpg",
              transformation: [
                { width: 800, height: 600, crop: "fill" },
                { quality: "auto" },
              ],
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          )
          .end(imageFile.buffer);
      });

      const imageResult = imageUploadResult as any;

      // Create image document
      const savedImage = await BikeImageModel.create({
        bikeId,
        src: imageResult.secure_url,
        alt: alt || `${bike.modelName} - Image ${existingImagesCount + 1}`,
        cloudinaryPublicId: imageResult.public_id,
        isPrimary: isFirstImage, // First image is automatically primary
      });

      res.status(201).json({
        success: true,
        message: `Image uploaded successfully for ${bike.modelName}`,
        data: {
          bikeId,
          image: savedImage,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to upload image",
      });
    }
  },
);
/** Minimum shared leading characters before a catalog entry counts as a match. */
const MIN_PREFIX_MATCH = 4;

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Strips everything that dealer exports and the catalog disagree about —
 * case, spaces, and separators — so "ACTIVA 125 DISC OBD2B" and "Activa 125"
 * become comparable as "ACTIVA125DISCOBD2B" / "ACTIVA125".
 */
const normalizeModel = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Length of the shared leading run of two already-normalized strings. */
const commonPrefixLength = (a: string, b: string) => {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
};

/**
 * Best catalog entry whose normalized model name shares at least
 * MIN_PREFIX_MATCH leading characters with `modelName`.
 *
 * Longest shared prefix wins, so "Activa 125" beats a bare "Activa" for
 * "ACTIVA 125 DISC OBD2B". Ties break toward the shorter catalog name, which
 * is the more general (and therefore safer) entry. The threshold is what keeps
 * near-misses apart: "SP125" vs "SP160" share only 2 characters and so never
 * match each other.
 */
const findBikeByModelPrefix = async (modelName: string) => {
  const target = normalizeModel(modelName);
  if (target.length < MIN_PREFIX_MATCH) return null;

  // The catalog is dealership-sized (tens of models), so scanning it in memory
  // is cheaper than trying to express this as a regex per candidate.
  const bikes = await BikeModel.find({ isActive: true })
    .select("_id modelName")
    .lean();

  let best: (typeof bikes)[number] | null = null;
  let bestScore = 0;

  for (const candidate of bikes) {
    const score = commonPrefixLength(
      target,
      normalizeModel(candidate.modelName),
    );
    if (score < MIN_PREFIX_MATCH) continue;

    const isBetter =
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        candidate.modelName.length < best.modelName.length);

    if (isBetter) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
};

/**
 * @desc    Get primary image for a bike by model name (for customer vehicle display)
 * @route   GET /api/bike-images/by-model/:modelName
 * @access  Public
 */
export const getPrimaryImageByModelName = asyncHandler(
  async (req: Request, res: Response) => {
    const modelName = decodeURIComponent(req.params.modelName).trim();

    if (!modelName) {
      res.status(400);
      throw new Error("Model name is required");
    }

    // Case-insensitive exact match against Bikes collection.
    let bike = await BikeModel.findOne({
      modelName: { $regex: new RegExp(`^${escapeRegex(modelName)}$`, "i") },
      isActive: true,
    })
      .select("_id modelName")
      .lean();

    // Fall back to a prefix match. CSV-imported stock carries dealer-export
    // model strings ("NX200-OBD2B", "ACTIVA 125 DISC OBD2B") that will never
    // equal a catalog name ("NX200", "Activa 125"), so an exact-only lookup
    // leaves every CSV vehicle with a blank image.
    let matchType: "exact" | "prefix" = "exact";
    if (!bike) {
      const fuzzy = await findBikeByModelPrefix(modelName);
      if (fuzzy) {
        bike = fuzzy;
        matchType = "prefix";
      }
    }

    if (!bike) {
      res.status(404).json({
        success: false,
        message: "No bike catalog entry found for this model",
        data: null,
      });
      return;
    }

    const primaryImage = await BikeImageModel.findOne({
      bikeId: bike._id,
      isPrimary: true,
      isActive: true,
    })
      .select("src alt")
      .lean();

    // Fallback: if no primary set, return the first active image
    const image =
      primaryImage ??
      (await BikeImageModel.findOne({ bikeId: bike._id, isActive: true })
        .select("src alt")
        .sort({ createdAt: 1 })
        .lean());

    res.status(200).json({
      success: true,
      data: image ? { src: image.src, alt: image.alt } : null,
      matchedModelName: bike.modelName,
      matchType,
    });
  },
);
