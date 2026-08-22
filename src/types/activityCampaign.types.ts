import mongoose, { Document } from "mongoose";

// SMS Campaign Interface
export interface ISMSCampaign {
  sentAt: Date;
  totalSent: number;
  deliveredCount: number;
  failedCount: number;
  cost: number; // SMS cost in INR
}

// Activity Interface
export interface IActivity extends Document {
  _id: string;
  name: string;
  date: Date;
  message: string;
  offers: string[];

  // Location & Targeting
  district: string;
  targetBranches: mongoose.Types.ObjectId[];
  targetCustomers: mongoose.Types.ObjectId[];

  // SMS Campaign Details
  smsTemplate: string;
  smsCampaign?: ISMSCampaign;

  // Admin Info
  createdBy: mongoose.Types.ObjectId; // Admin/BranchManager who created
  approvedBy?: mongoose.Types.ObjectId; // Super-Admin approval

  // Status
  status: "Draft" | "Scheduled" | "Sent" | "Completed" | "Cancelled";
  scheduledFor?: Date;

  // Metadata
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
