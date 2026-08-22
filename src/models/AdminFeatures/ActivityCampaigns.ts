import mongoose, { Schema } from "mongoose";
import { IActivity, ISMSCampaign } from "../../types/activityCampaign.types";

// SMS Campaign Schema
const smsCampaignSchema = new Schema<ISMSCampaign>({
  sentAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  totalSent: {
    type: Number,
    required: true,
    min: [0, "Total sent cannot be negative"],
  },
  deliveredCount: {
    type: Number,
    default: 0,
    min: [0, "Delivered count cannot be negative"],
  },
  failedCount: {
    type: Number,
    default: 0,
    min: [0, "Failed count cannot be negative"],
  },
  cost: {
    type: Number,
    required: true,
    min: [0, "SMS cost cannot be negative"],
  },
});

// Main Activity Schema
const activitySchema = new Schema<IActivity>(
  {
    name: {
      type: String,
      required: [true, "Activity name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    date: {
      type: Date,
      required: [true, "Activity date is required"],
    },
    message: {
      type: String,
      required: [true, "Activity message is required"],
      trim: true,
      maxlength: [500, "Message cannot exceed 500 characters"],
    },
    offers: [
      {
        type: String,
        trim: true,
        maxlength: [100, "Each offer cannot exceed 100 characters"],
      },
    ],

    // Location targeting
    district: {
      type: String,
      required: [true, "District is required"],
      trim: true,
      uppercase: true,
    },
    targetBranches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],
    targetCustomers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
      },
    ],

    // SMS details
    smsTemplate: {
      type: String,
      required: [true, "SMS template is required"],
      trim: true,
      maxlength: [160, "SMS template cannot exceed 160 characters"],
    },
    smsCampaign: {
      type: smsCampaignSchema,
    },

    // Authorization
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Creator is required"],
      refPath: "createdByModel",
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },

    // Status management
    status: {
      type: String,
      required: [true, "Status is required"],
      enum: ["Draft", "Scheduled", "Sent", "Completed", "Cancelled"],
      default: "Draft",
    },
    scheduledFor: {
      type: Date,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
activitySchema.index({ district: 1, status: 1 });
activitySchema.index({ date: 1 });
activitySchema.index({ createdBy: 1 });
activitySchema.index({ status: 1, scheduledFor: 1 });

// Pre-save validation
activitySchema.pre("save", function (next) {
  // Ensure scheduled activities have scheduledFor date
  if (this.status === "Scheduled" && !this.scheduledFor) {
    return next(new Error("Scheduled activities must have a scheduled date"));
  }

  // Ensure activity date is not in the past for new activities
  if (this.isNew && this.date < new Date()) {
    return next(new Error("Activity date cannot be in the past"));
  }

  next();
});

// Virtual for offer count
activitySchema.virtual("offerCount").get(function () {
  return this.offers?.length || 0;
});

// Method to generate SMS content
activitySchema.methods.generateSMSContent = function () {
  let smsContent = this.smsTemplate;
  smsContent = smsContent.replace("{{name}}", this.name);
  smsContent = smsContent.replace("{{date}}", this.date.toDateString());
  smsContent = smsContent.replace("{{district}}", this.district);

  if (this.offers && this.offers.length > 0) {
    smsContent += ` Offers: ${this.offers.join(", ")}`;
  }

  return smsContent.substring(0, 160); // SMS limit
};

const ActivityModel = mongoose.model<IActivity>("Activity", activitySchema);

export default ActivityModel;
//connect a bulk sms api
