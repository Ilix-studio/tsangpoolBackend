// models/EnquiryModel.ts
import mongoose, { Document, Schema } from "mongoose";

export interface IEnquiry extends Document {
  name: string;
  phoneNumber: string;
  address: {
    village: string;
    district: string;
    state: string;
    pinCode: number;
  };
  status: "new" | "contacted" | "resolved";
  createdAt: Date;
  updatedAt: Date;
}

const enquirySchema = new Schema<IEnquiry>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot be more than 100 characters"],
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      match: [/^[6-9]\d{9}$/, "Please enter a valid 10-digit phone number"],
      trim: true,
    },
    address: {
      village: {
        type: String,
        required: [true, "Street address is required"],
        trim: true,
        maxlength: [200, "Street address cannot exceed 200 characters"],
      },
      district: {
        type: String,
        required: [true, "City is required"],
        trim: true,
        maxlength: [100, "City name cannot exceed 100 characters"],
      },
      state: {
        type: String,
        required: [true, "State is required"],
        trim: true,
        maxlength: [50, "State name cannot exceed 50 characters"],
      },
      pinCode: {
        type: String,
        required: [true, "Postal code is required"],
        trim: true,
        maxlength: [6, "Postal code cannot exceed 6 characters"],
      },
    },
    status: {
      type: String,
      enum: ["new", "contacted", "resolved"],
      default: "new",
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware for capitalization
enquirySchema.pre("save", function (next) {
  const capitalize = (str: string) =>
    str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();

  if (this.name) this.name = this.name.trim();
  if (this.address.district)
    this.address.district = capitalize(this.address.district);
  if (this.address.state) this.address.state = capitalize(this.address.state);

  next();
});

// Virtual for full address
enquirySchema.virtual("fullAddress").get(function (this: IEnquiry) {
  return `${this.address.village}, ${this.address.district}, ${this.address.state}, ${this.address.pinCode}`;
});

enquirySchema.set("toJSON", { virtuals: true });
enquirySchema.set("toObject", { virtuals: true });

const EnquiryModel = mongoose.model<IEnquiry>("Enquiry", enquirySchema);

export default EnquiryModel;
