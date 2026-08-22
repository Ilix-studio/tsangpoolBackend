import mongoose, { Schema, Document } from "mongoose";

export interface IServiceBooking extends Document {
  _id: string;

  // Required References (authenticated customers only)
  customer: mongoose.Types.ObjectId; // Reference to BaseCustomer
  vehicle: mongoose.Types.ObjectId; // Reference to CustomerVehicle

  // Service Details
  serviceType: string; // Single service only
  usedServices: string[]; // Track all services customer has used

  // Schedule Information
  branch: mongoose.Types.ObjectId; // Reference to Branch
  appointmentDate: Date;
  appointmentTime: string;
  location: string; // Selected service location

  // Additional Information
  specialRequests?: string;
  serviceOptions?: {
    isDropOff: boolean;
    willWaitOnsite: boolean;
  };

  // System Fields
  bookingId: string; // Auto-generated booking reference
  status: "pending" | "confirmed" | "in-progress" | "completed" | "cancelled";
  priority?: "normal" | "urgent";
  estimatedCost?: number;
  actualCost?: number;
  estimatedDuration?: string;

  // Assigned staff and notes
  assignedTechnician?: string;
  serviceNotes?: string;
  internalNotes?: string;

  // Notification tracking
  adminNotificationSent?: boolean;
  notificationSentAt?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
  completedAt?: Date;

  // Virtual fields
  appointmentDateTime?: string;
  customerFullName?: string;
  daysUntilAppointment?: number;

  jobCard?: mongoose.Types.ObjectId | null;

  // Instance methods
  confirmBooking(): Promise<IServiceBooking>;
  cancelBooking(reason?: string): Promise<IServiceBooking>;
  completeBooking(
    actualCost?: number,
    serviceNotes?: string,
  ): Promise<IServiceBooking>;
  sendAdminNotification(): Promise<void>;
}

// Interface for static methods
export interface IServiceBookingModel extends mongoose.Model<IServiceBooking> {
  checkAvailability(
    branchId: string,
    date: Date,
    time: string,
  ): Promise<boolean>;
  checkAvailabilityWithBuffer(
    branchId: string,
    date: Date,
    time: string,
    bufferMinutes: number,
  ): Promise<boolean>;
  getAvailableTimeSlots(branchId: string, date: Date): Promise<string[]>;
  hasCustomerUsedService(
    customerId: string,
    serviceType: string,
  ): Promise<boolean>;
  getCustomerServiceCount(
    customerId: string,
    serviceType?: string,
  ): Promise<number>;
}

const serviceBookingSchema = new Schema<IServiceBooking>(
  {
    // Required references for authenticated customers
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BaseCustomer",
      required: [true, "Customer reference is required"],
      index: true,
    },

    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerVehicle",
      required: [true, "Vehicle reference is required"],
      index: true,
    },

    // Service Details with Mock Service Types
    serviceType: {
      type: String,
      required: [true, "Service type is required"],
      enum: [
        // Free Services (3)
        "free-service-one",
        "free-service-two",
        "free-service-three",

        // Paid Services (25)
        "paid-service-one",
        "paid-service-two",
        "paid-service-three",
        "paid-service-four",
        "paid-service-five",
        "paid-service-six",
        "paid-service-seven",
        "paid-service-eight",
        "paid-service-nine",
        "paid-service-ten",
        "paid-service-eleven",
        "paid-service-twelve",
        "paid-service-thirteen",
        "paid-service-fourteen",
        "paid-service-fifteen",
        "paid-service-sixteen",
        "paid-service-seventeen",
        "paid-service-eighteen",
        "paid-service-nineteen",
        "paid-service-twenty",
        "paid-service-twenty-one",
        "paid-service-twenty-two",
        "paid-service-twenty-three",
        "paid-service-twenty-four",
        "paid-service-twenty-five",
      ],
    },

    // Track services customer has used to prevent duplicates
    usedServices: [
      {
        type: String,
        required: true,
      },
    ],

    // Schedule Information with availability checking
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: [true, "Branch reference is required"],
      index: true,
    },

    appointmentDate: {
      type: Date,
      required: [true, "Appointment date is required"],
      validate: {
        validator: function (date: Date) {
          return date >= new Date();
        },
        message: "Appointment date cannot be in the past",
      },
    },

    appointmentTime: {
      type: String,
      required: [true, "Appointment time is required"],
      match: [
        /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
        "Invalid time format (HH:MM)",
      ],
    },

    location: {
      type: String,
      required: [true, "Service location is required"],
      trim: true,
      enum: ["branch", "home", "office", "roadside"],
    },

    // System Fields
    bookingId: {
      type: String,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "confirmed", "in-progress", "completed", "cancelled"],
      default: "pending",
      index: true,
    },

    priority: {
      type: String,
      enum: ["normal", "urgent"],
      default: "normal",
    },

    estimatedCost: {
      type: Number,
      min: [0, "Estimated cost cannot be negative"],
    },

    actualCost: {
      type: Number,
      min: [0, "Actual cost cannot be negative"],
    },

    estimatedDuration: {
      type: String,
      trim: true,
    },

    // Assigned staff and notes
    assignedTechnician: {
      type: String,
      trim: true,
    },

    serviceNotes: {
      type: String,
      trim: true,
    },

    internalNotes: {
      type: String,
      trim: true,
    },

    jobCard: {
      type: Schema.Types.ObjectId,
      ref: "JobCard",
      default: null,
    },

    // Notification tracking
    adminNotificationSent: {
      type: Boolean,
      default: false,
    },

    notificationSentAt: {
      type: Date,
    },

    // Timestamps
    confirmedAt: Date,
    completedAt: Date,
  },
  {
    timestamps: true,
  },
);

// Indexes for performance and availability checking
serviceBookingSchema.index({ customer: 1, appointmentDate: 1 });
serviceBookingSchema.index({
  branch: 1,
  appointmentDate: 1,
  appointmentTime: 1,
});
serviceBookingSchema.index({ status: 1, appointmentDate: 1 });
serviceBookingSchema.index({ vehicle: 1, status: 1 });

// Pre-save middleware to generate booking ID
serviceBookingSchema.pre("save", async function (next) {
  if (this.isNew && !this.bookingId) {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const count = await mongoose.model("ServiceBooking").countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
      },
    });
    this.bookingId = `SB-${dateStr}-${String(count + 1).padStart(4, "0")}`;
  }
  next();
});

// Pre-save middleware to check availability
serviceBookingSchema.pre("save", async function (next) {
  if (
    this.isNew ||
    this.isModified("appointmentDate") ||
    this.isModified("appointmentTime")
  ) {
    const conflictingBooking = await mongoose.model("ServiceBooking").findOne({
      branch: this.branch,
      appointmentDate: this.appointmentDate,
      appointmentTime: this.appointmentTime,
      status: { $in: ["pending", "confirmed", "in-progress"] },
      _id: { $ne: this._id },
    });

    if (conflictingBooking) {
      const error = new Error("Time slot not available");
      error.name = "ValidationError";
      return next(error);
    }
  }
  next();
});

// Virtual fields
serviceBookingSchema.virtual("appointmentDateTime").get(function () {
  if (this.appointmentDate && this.appointmentTime) {
    const date = new Date(this.appointmentDate);
    const [hours, minutes] = this.appointmentTime.split(":");
    date.setHours(parseInt(hours), parseInt(minutes));
    return date.toISOString();
  }
  return undefined;
});

serviceBookingSchema.virtual("customerFullName").get(function () {
  if (this.populated("customer") && this.customer) {
    const customer = this.customer as any;
    if (customer.profile) {
      return `${customer.profile.firstName} ${customer.profile.lastName}`;
    }
  }
  return undefined;
});

serviceBookingSchema.virtual("daysUntilAppointment").get(function () {
  if (this.appointmentDate) {
    const today = new Date();
    const appointmentDate = new Date(this.appointmentDate);
    const diffTime = appointmentDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  return undefined;
});

// Instance methods
serviceBookingSchema.methods.confirmBooking = async function () {
  this.status = "confirmed";
  this.confirmedAt = new Date();
  return await this.save();
};

serviceBookingSchema.methods.cancelBooking = async function (reason?: string) {
  this.status = "cancelled";
  if (reason) {
    this.internalNotes = `Cancelled: ${reason}`;
  }
  return await this.save();
};

serviceBookingSchema.methods.completeBooking = async function (
  actualCost?: number,
  serviceNotes?: string,
) {
  this.status = "completed";
  this.completedAt = new Date();
  if (actualCost !== undefined) {
    this.actualCost = actualCost;
  }
  if (serviceNotes) {
    this.serviceNotes = serviceNotes;
  }
  return await this.save();
};

serviceBookingSchema.methods.sendAdminNotification = async function () {
  if (!this.adminNotificationSent) {
    // Here you would integrate with your notification system
    // For now, just mark as sent
    this.adminNotificationSent = true;
    this.notificationSentAt = new Date();
    await this.save();
  }
};

// Static method to check availability with time buffer
serviceBookingSchema.statics.checkAvailabilityWithBuffer = async function (
  branchId: string,
  date: Date,
  time: string,
  bufferMinutes: number = 20,
) {
  // Convert time to minutes for calculation
  const [hours, minutes] = time.split(":").map(Number);
  const appointmentMinutes = hours * 60 + minutes;

  // Find existing bookings for the same branch and date
  const existingBookings = await this.find({
    branch: branchId,
    appointmentDate: date,
    status: { $in: ["pending", "confirmed", "in-progress"] },
  }).select("appointmentTime");

  // Check if any existing booking conflicts with buffer
  for (const booking of existingBookings) {
    const [existingHours, existingMins] = booking.appointmentTime
      .split(":")
      .map(Number);
    const existingMinutes = existingHours * 60 + existingMins;

    const timeDifference = Math.abs(appointmentMinutes - existingMinutes);

    if (timeDifference < bufferMinutes) {
      return false;
    }
  }

  return true;
};
serviceBookingSchema.statics.checkAvailability = async function (
  branchId: string,
  date: Date,
  time: string,
) {
  const existingBooking = await this.findOne({
    branch: branchId,
    appointmentDate: date,
    appointmentTime: time,
    status: { $in: ["pending", "confirmed", "in-progress"] },
  });

  return !existingBooking;
};

// Static method to get available time slots
serviceBookingSchema.statics.getAvailableTimeSlots = async function (
  branchId: string,
  date: Date,
) {
  const allTimeSlots = [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "14:00",
    "14:30",
    "15:00",
    "15:30",
    "16:00",
    "16:30",
    "17:00",
    "17:30",
  ];

  const bookedSlots = await this.find({
    branch: branchId,
    appointmentDate: date,
    status: { $in: ["pending", "confirmed", "in-progress"] },
  }).select("appointmentTime");

  const bookedTimes = bookedSlots.map(
    (booking: any) => booking.appointmentTime,
  );

  return allTimeSlots.filter((slot) => !bookedTimes.includes(slot));
};

// Static method to check if customer has used a service
serviceBookingSchema.statics.hasCustomerUsedService = async function (
  customerId: string,
  serviceType: string,
) {
  const existingBooking = await this.findOne({
    customer: customerId,
    serviceType: serviceType,
    status: { $in: ["pending", "confirmed", "in-progress", "completed"] }, // Include pending
  });

  return !!existingBooking;
};

// Static method to get customer's service usage count
serviceBookingSchema.statics.getCustomerServiceCount = async function (
  customerId: string,
  serviceType?: string,
) {
  const query: any = {
    customer: customerId,
    status: { $in: ["confirmed", "completed"] },
  };

  if (serviceType) {
    query.serviceType = serviceType;
  }

  return await this.countDocuments(query);
};

// Ensure virtual fields are serialized
serviceBookingSchema.set("toJSON", { virtuals: true });
serviceBookingSchema.set("toObject", { virtuals: true });

export const ServiceBookingModel = mongoose.model<
  IServiceBooking,
  IServiceBookingModel
>("ServiceBooking", serviceBookingSchema);

export default ServiceBookingModel;
