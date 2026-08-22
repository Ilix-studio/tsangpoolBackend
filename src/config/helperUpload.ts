import { v2 as cloudinary } from "cloudinary";

// Enhanced Cloudinary upload for bike images with multiple transformations
export const uploadBikeImageToCloudinary = (
  buffer: Buffer,
  originalName: string,
  bikeModelName: string,
  index: number = 0
): Promise<{ src: string; alt: string; cloudinaryPublicId: string }> => {
  return new Promise((resolve, reject) => {
    const publicId = `bike_${Date.now()}_${bikeModelName.replace(
      /\s+/g,
      "_"
    )}_${index}`;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "honda-golaghat-dealer-bikes",
        public_id: publicId,
        transformation: [
          // Create multiple sizes for responsive images
          {
            width: 1200,
            height: 800,
            crop: "fill",
            quality: "auto",
            format: "webp",
          },
          {
            width: 800,
            height: 600,
            crop: "fill",
            quality: "auto",
            format: "jpg",
          },
          {
            width: 400,
            height: 300,
            crop: "fill",
            quality: "auto",
            format: "jpg",
          },
        ],
        eager: [
          // Generate thumbnail versions
          {
            width: 300,
            height: 200,
            crop: "fill",
            quality: "auto",
            format: "jpg",
          },
          {
            width: 150,
            height: 100,
            crop: "fill",
            quality: "auto",
            format: "jpg",
          },
        ],
        eager_async: true,
        resource_type: "image",
        overwrite: true,
        invalidate: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            src: result!.secure_url,
            alt: `${bikeModelName} - Image ${index + 1}`,
            cloudinaryPublicId: result!.public_id,
          });
        }
      }
    );
    uploadStream.end(buffer);
  });
};

// Upload multiple bike images with proper naming and optimization
export const uploadMultipleBikeImages = async (
  files: Express.Multer.File[],
  bikeModelName: string
): Promise<
  { src: string; alt: string; cloudinaryPublicId: string; isPrimary: boolean }[]
> => {
  const uploadPromises = files.map((file, index) =>
    uploadBikeImageToCloudinary(
      file.buffer,
      file.originalname,
      bikeModelName,
      index
    ).then((result) => ({
      ...result,
      isPrimary: index === 0, // First image is primary
    }))
  );

  return Promise.all(uploadPromises);
};

// Helper function to upload image to Cloudinary (backward compatibility)
export const uploadToCloudinary = (
  buffer: Buffer,
  originalName: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "honda-golaghat-dealer/bikes",
        public_id: `bike_${Date.now()}_${originalName.split(".")[0]}`,
        transformation: [
          { width: 800, height: 600, crop: "limit", quality: "auto" },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result!.secure_url);
        }
      }
    );
    uploadStream.end(buffer);
  });
};

// Enhanced delete function with better error handling
export const deleteFromCloudinary = async (imageUrl: string): Promise<void> => {
  try {
    // Extract public_id from URL more reliably
    const urlParts = imageUrl.split("/");
    const uploadIndex = urlParts.indexOf("upload");

    if (uploadIndex === -1) {
      throw new Error("Invalid Cloudinary URL format");
    }

    // Get the part after "upload/" and remove version if present
    const pathAfterUpload = urlParts.slice(uploadIndex + 1).join("/");
    const publicIdWithExtension = pathAfterUpload.replace(/^v\d+\//, ""); // Remove version prefix
    const publicId = publicIdWithExtension.replace(/\.[^/.]+$/, ""); // Remove extension

    console.log(`Deleting image with public_id: ${publicId}`);

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result !== "ok" && result.result !== "not found") {
      console.warn(
        `Cloudinary deletion warning: ${result.result} for ${publicId}`
      );
    }
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    // Don't throw error to prevent deletion failures from blocking other operations
  }
};

// Delete multiple images from Cloudinary
export const deleteMultipleFromCloudinary = async (
  imageUrls: string[]
): Promise<void> => {
  const deletePromises = imageUrls.map((url) => deleteFromCloudinary(url));
  await Promise.allSettled(deletePromises); // Use allSettled to continue even if some deletions fail
};

// Generate responsive image URLs for different screen sizes
export const generateResponsiveImageUrls = (cloudinaryPublicId: string) => {
  const baseUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;

  return {
    thumbnail: `${baseUrl}/w_150,h_100,c_fill,q_auto,f_jpg/${cloudinaryPublicId}`,
    small: `${baseUrl}/w_300,h_200,c_fill,q_auto,f_jpg/${cloudinaryPublicId}`,
    medium: `${baseUrl}/w_600,h_400,c_fill,q_auto,f_jpg/${cloudinaryPublicId}`,
    large: `${baseUrl}/w_800,h_600,c_fill,q_auto,f_jpg/${cloudinaryPublicId}`,
    xlarge: `${baseUrl}/w_1200,h_800,c_fill,q_auto,f_webp/${cloudinaryPublicId}`,
    original: `${baseUrl}/${cloudinaryPublicId}`,
  };
};

// Optimize existing bike image URLs (for migration)
export const optimizeImageUrl = (
  originalUrl: string,
  width?: number,
  height?: number
): string => {
  if (!originalUrl.includes("cloudinary")) {
    return originalUrl;
  }

  const transformation = [];
  if (width) transformation.push(`w_${width}`);
  if (height) transformation.push(`h_${height}`);
  transformation.push("c_fill", "q_auto", "f_auto");

  const transformationString = transformation.join(",");

  // Insert transformation into existing URL
  return originalUrl.replace("/upload/", `/upload/${transformationString}/`);
};

// Validate image file before upload
export const validateImageFile = (
  file: Express.Multer.File
): { isValid: boolean; error?: string } => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return {
      isValid: false,
      error: `Invalid file type: ${
        file.mimetype
      }. Allowed types: ${allowedTypes.join(", ")}`,
    };
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File size too large: ${(file.size / 1024 / 1024).toFixed(
        2
      )}MB. Maximum allowed: 10MB`,
    };
  }

  return { isValid: true };
};

// Batch validate multiple image files
export const validateMultipleImageFiles = (
  files: Express.Multer.File[]
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!files || files.length === 0) {
    errors.push("At least one image file is required");
    return { isValid: false, errors };
  }

  if (files.length > 10) {
    errors.push("Maximum 10 images allowed");
    return { isValid: false, errors };
  }

  files.forEach((file, index) => {
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      errors.push(`File ${index + 1}: ${validation.error}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
};
