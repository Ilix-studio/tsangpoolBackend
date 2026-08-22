import asyncHandler from "express-async-handler";
import Admin from "../models/Admin";

/**
 * @desc    Seed admin user
 * @route   POST /api/admin/seed
 * @access  Public (should be protected in production)
 */
const seedAdmin = asyncHandler(async (req, res) => {
  try {
    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      email: "honda_golaghat@gmail.com",
    });

    if (!existingAdmin) {
      // Create admin user
      const admin = await Admin.create({
        name: "Honda-Golaghat",
        email: "honda_golaghat@gmail.com",
        password: "admin123",
        role: "Super-Admin",
      });

      // Return success response
      res.status(201).json({
        success: true,
        message: "Super-Admin user created successfully",
        data: {
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
      });
    } else {
      // Admin already exists
      res.status(200).json({
        success: true,
        message: "Super-Admin user already exists",
        data: {
          name: existingAdmin.name,
          email: existingAdmin.email,
        },
      });
    }
  } catch (error) {
    res.status(500);
    throw new Error(
      `Error seeding admin: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
});

export default seedAdmin;

//Remove the branch from Admin mOdel to add super-Admin infomation in DB
