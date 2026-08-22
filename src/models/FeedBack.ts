import mongoose, { Document, Schema } from "mongoose";

export interface IFeedback extends Document {
  _id: string;
  customer: mongoose.Types.ObjectId;
  vehicle: mongoose.Types.ObjectId;
  message: string;
  photos: string[];
  rating?: number;
  status: "pending" | "reviewed" | "resolved";
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  adminReply?: string;
  createdAt: Date;
  updatedAt: Date;
}

const feedbackSchema = new Schema<IFeedback>(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: [true, "Customer reference is required"],
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerDashModel",
      required: [true, "Vehicle reference is required"],
    },

    message: {
      type: String,
      required: [true, "Feedback message is required"],
      trim: true,
      minlength: [10, "Message must be at least 10 characters long"],
      maxlength: [1000, "Message cannot exceed 1000 characters"],
    },

    photos: [
      {
        type: String, // Cloudinary URLs
        validate: {
          validator: function (photos: string[]) {
            return photos.length <= 3;
          },
          message: "Maximum 3 photos allowed",
        },
      },
    ],

    rating: {
      type: Number,
      min: [1, "Rating must be between 1 and 5"],
      max: [5, "Rating must be between 1 and 5"],
    },

    status: {
      type: String,
      enum: ["pending", "reviewed", "resolved"],
      default: "pending",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },

    reviewedAt: {
      type: Date,
    },

    adminReply: {
      type: String,
      trim: true,
      maxlength: [500, "Admin reply cannot exceed 500 characters"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance

feedbackSchema.index({ vehicle: 1 });
feedbackSchema.index({ status: 1 });
feedbackSchema.index({ rating: 1 });

// Virtual to get customer name from populated customer
feedbackSchema.virtual("customerName").get(function (this: IFeedback) {
  if (this.populated("customer")) {
    const customer = this.customer as any;
    return `${customer.firstName} ${customer.lastName}`;
  }
  return null;
});

// Virtual to get bike name from populated vehicle
feedbackSchema.virtual("bikeName").get(function (this: IFeedback) {
  if (this.populated("vehicle")) {
    const vehicle = this.vehicle as any;
    return vehicle.motorcyclemodelName;
  }
  return null;
});

// Ensure virtual fields are serialized
feedbackSchema.set("toJSON", { virtuals: true });
feedbackSchema.set("toObject", { virtuals: true });

// Pre-save middleware to set reviewedAt when status changes to reviewed
feedbackSchema.pre("save", function (next) {
  if (
    this.isModified("status") &&
    this.status === "reviewed" &&
    !this.reviewedAt
  ) {
    this.reviewedAt = new Date();
  }
  next();
});

// Static method to get feedback stats
feedbackSchema.statics.getFeedbackStats = async function (vehicleId?: string) {
  const matchQuery = vehicleId ? { vehicle: vehicleId } : {};

  return await this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalFeedbacks: { $sum: 1 },
        averageRating: { $avg: "$rating" },
        pendingCount: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
        reviewedCount: {
          $sum: { $cond: [{ $eq: ["$status", "reviewed"] }, 1, 0] },
        },
        resolvedCount: {
          $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
        },
      },
    },
  ]);
};

// Instance method to check if feedback can be edited
feedbackSchema.methods.canEdit = function () {
  return this.status === "pending";
};

const FeedbackModel = mongoose.model<IFeedback>("Feedback", feedbackSchema);

export default FeedbackModel;
