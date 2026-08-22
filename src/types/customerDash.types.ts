import mongoose, { Document } from "mongoose";

// RTO Information Interface
export interface IRTOInfo {
  rtoCode: string;
  rtoName: string;
  rtoAddress: string;
  state: string;
}

// Service Status Interface
export interface IServiceStatus {
  lastServiceDate?: Date;
  nextServiceDue?: Date;
  serviceType: "Regular" | "Overdue" | "Due Soon" | "Up to Date";
  kilometers: number;
  serviceHistory: number; // Total services completed
}

// MC Basic Info Interface
export interface IMCBasicInfo extends Document {
  _id: string;

  // Basic Vehicle Info
  motorcyclemodelName: string;
  engineNumber: string;
  chassisNumber: string;
  numberPlate: string;

  // Owner Information
  registeredOwnerName: string;
  customer: mongoose.Types.ObjectId; // Reference to Customer

  // Vehicle Documentation
  motorcyclePhoto?: string; // Cloudinary URL
  rtoInfo: IRTOInfo;
  fitnessUpTo: Date;
  vehicleAge: number; // in years
  registrationDate: Date;

  // Service Information
  serviceStatus: IServiceStatus;

  isFitnessExpired(): boolean;
  getServiceStatusDescription(): string;

  activeBadges?: any; // or appropriate type
  activeServicesCount?: number;
  activeServices?: any; // or appropriate type

  // Status
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
