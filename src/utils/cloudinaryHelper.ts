import { v2 as cloudinary } from "cloudinary";

// Helper function to upload image to Cloudinary
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
// Helper function to delete image from Cloudinary
export const deleteFromCloudinary = async (imageUrl: string): Promise<void> => {
  try {
    // Extract public_id from URL
    const urlParts = imageUrl.split("/");
    const publicIdWithExtension = urlParts[urlParts.length - 1];
    const publicId = publicIdWithExtension.split(".")[0];
    const fullPublicId = `honda-golaghat-dealer/bikes/${publicId}`;

    await cloudinary.uploader.destroy(fullPublicId);
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
  }
};
