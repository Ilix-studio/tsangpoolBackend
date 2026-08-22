// types/customer.types.ts - Update customer types
export interface ICustomerWithProfile {
  // Base customer data
  _id: string;
  firebaseUid?: string;
  phoneNumber: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;

  // Profile data (optional)
  profile?: {
    firstName: string;
    middleName?: string;
    lastName: string;
    email?: string;
    village: string;
    postOffice: string;
    policeStation: string;
    district: string;
    state: string;
    profileCompleted: boolean;
    fullName?: string;
    fullAddress?: string;
  };

  // Computed fields
  profileCompleted: boolean;
  fullName?: string;
  fullAddress?: string;
}
