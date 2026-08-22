import mongoose, { Document, Schema } from "mongoose";

export interface IBikeImageDocument extends Document {
  bikeId: mongoose.Types.ObjectId;
  src: string;
  alt: string;
  cloudinaryPublicId: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BikeImageSchema = new Schema<IBikeImageDocument>(
  {
    bikeId: {
      type: Schema.Types.ObjectId,
      ref: "Bikes",
      required: [true, "Bike ID is required"],
    },
    src: {
      type: String,
      required: [true, "Image URL is required"],
    },
    alt: {
      type: String,
      required: [true, "Image alt text is required"],
    },
    cloudinaryPublicId: {
      type: String,
      required: [true, "Cloudinary public ID is required"],
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
BikeImageSchema.index({ bikeId: 1 });
BikeImageSchema.index({ isPrimary: -1 });

const BikeImageModel = mongoose.model<IBikeImageDocument>(
  "BikeImage",
  BikeImageSchema
);
export default BikeImageModel;
