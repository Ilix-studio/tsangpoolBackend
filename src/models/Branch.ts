import mongoose, { Document, Schema } from "mongoose";

export interface HoursType {
  weekdays: string;
  saturday: string;
  sunday: string;
}

export interface IBranch extends Document {
  id: string;
  branchName: string;
  address: string;
  phone: string;
  email: string;
  hours: HoursType;
  mapUrl?: string; // Optional field
  // Stable per-branch letter code (e.g. "A", "B", ..., "Z", "AA") used as the
  // prefix for B2B Sales challan numbers. Deliberately assigned, not derived
  // from creation order at read time — see scripts/backfillBranchChallanPrefixes.ts.
  challanPrefix?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HoursSchema = new Schema<HoursType>({
  weekdays: {
    type: String,
    required: [true, "Please add weekday hours"],
  },
  saturday: {
    type: String,
    required: [true, "Please add Saturday hours"],
  },
  sunday: {
    type: String,
    required: [true, "Please add Sunday hours"],
  },
});

const BranchSchema = new Schema<IBranch>(
  {
    id: {
      type: String,
      required: [true, "Please add a branch ID"],
      unique: true,
      trim: true,
    },
    branchName: {
      type: String,
      required: [true, "Please add branch name"],
      trim: true,
    },
    address: {
      type: String,
      required: [true, "Please add branch address"],
    },
    phone: {
      type: String,
      required: [true, "Please add phone number"],
    },
    email: {
      type: String,
      required: [true, "Please add email"],
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please add a valid email",
      ],
    },
    hours: {
      type: HoursSchema,
      required: [true, "Please add branch hours"],
    },
    mapUrl: {
      type: String,
      required: false,
    },
    challanPrefix: {
      type: String,
      uppercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

BranchSchema.index(
  { challanPrefix: 1 },
  { unique: true, sparse: true },
);

const Branch = mongoose.model<IBranch>("Branch", BranchSchema);

export default Branch;
