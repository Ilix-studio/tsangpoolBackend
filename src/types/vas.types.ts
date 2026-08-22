import mongoose from "mongoose";

// Value Added Service Interface
export interface IValueAddedService extends Document {
  _id: string;
  serviceName: string;
  customer: mongoose.Types.ObjectId;
  // Coverage Details
  coverageYears: number;

  // Price Structure
  priceStructure: {
    basePrice: number;
  };

  // Benefits
  benefits: string[];

  // Admin fields
  isActive: boolean;
  applicableBranches: mongoose.Types.ObjectId[];
  validFrom: Date;
  validUntil: Date;

  createdAt: Date;
  updatedAt: Date;
}
// Customer Active Services Model (for tracking activated services)
export interface ICustomerActiveService {
  customer: mongoose.Types.ObjectId;
  vehicle: mongoose.Types.ObjectId;
  service: mongoose.Types.ObjectId;
  activatedBy: mongoose.Types.ObjectId; // Admin who activated
  activationDate: Date;
  expiryDate: Date;
  isActive: boolean;
}
