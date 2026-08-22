import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { getMe, updateMe } from "../../controllers/AdminFeature/profile.controller";
import {
  createBranchAdmin,
  getAllBranchAdmins,
  deleteBranchAdmin,
  createServiceAdmin,
  getAllServiceAdmins,
  deleteServiceAdmin,
  createPartAdmin,
  getAllPartAdmins,
  deletePartAdmin,
  createDeveloper,
  getAllDevelopers,
  deleteDeveloper,
  createStaff,
  getAllStaff,
  deleteStaff,
} from "../../controllers/AdminFeature/usermanagement.controller";

const router = express.Router();

// All routes require authentication
router.use(protect);

// ===== CURRENT USER PROFILE (any authenticated role — own profile only) =====
router.get("/me", getMe);
router.patch("/me", updateMe);

// ===== BRANCH-ADMIN (Super-Admin only) =====
router.post("/branch-admin", authorize("Super-Admin"), createBranchAdmin);
router.get("/branch-admins", authorize("Super-Admin"), getAllBranchAdmins);
router.delete("/branch-admin/:id", authorize("Super-Admin"), deleteBranchAdmin);

// ===== SERVICE-ADMIN (Super-Admin any branch; Branch-Admin own branch) =====
router.post(
  "/service-admin",
  authorize("Super-Admin", "Branch-Admin"),
  createServiceAdmin,
);
router.get(
  "/service-admins",
  authorize("Super-Admin", "Branch-Admin"),
  getAllServiceAdmins,
);
router.delete(
  "/service-admin/:id",
  authorize("Super-Admin", "Branch-Admin"),
  deleteServiceAdmin,
);

// ===== PART-ADMIN (Super-Admin any branch; Branch-Admin own branch) =====
router.post(
  "/part-admin",
  authorize("Super-Admin", "Branch-Admin"),
  createPartAdmin,
);
router.get(
  "/part-admins",
  authorize("Super-Admin", "Branch-Admin"),
  getAllPartAdmins,
);
// Developer — project-wide maintenance role, Super-Admin only (no branch,
// so Branch-Admin has nothing to scope a creation to).
router.post("/developer", authorize("Super-Admin"), createDeveloper);
router.get("/developers", authorize("Super-Admin"), getAllDevelopers);
router.delete("/developer/:id", authorize("Super-Admin"), deleteDeveloper);

router.delete(
  "/part-admin/:id",
  authorize("Super-Admin", "Branch-Admin"),
  deletePartAdmin,
);

// ===== STAFF (Branch-Admin creates; Super-Admin + Branch-Admin can list/delete) =====
router.post("/staff", authorize("Branch-Admin"), createStaff);
router.get("/staff", authorize("Super-Admin", "Branch-Admin"), getAllStaff);
router.delete(
  "/staff/:id",
  authorize("Super-Admin", "Branch-Admin"),
  deleteStaff,
);

export default router;
