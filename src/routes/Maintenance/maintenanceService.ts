import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import {
  createMaintenanceService,
  getMaintenanceServices,
  updateMaintenanceService,
  deleteMaintenanceService,
} from "../../controllers/Maintenance/maintenanceService.controller";

const router = express.Router();

router.use(protect);

// Raise a request. Super-Admin is both a reporter and a recipient here: they
// can file work for a Developer directly, and still read the whole queue below.
// This list must stay in step with RAISER_MODEL_BY_ROLE in the controller and
// the `raisedByModel` enum on the model — the controller rejects any role the
// map does not cover, so widening only this list is not enough.
router.post(
  "/",
  authorize("Super-Admin", "Branch-Admin", "Service-Admin", "Part-Admin"),
  createMaintenanceService,
);

// Read — Developer/Super-Admin get the full queue; reporters get their own
// (scoped inside the controller, not by role here).
router.get(
  "/",
  authorize(
    "Developer",
    "Super-Admin",
    "Branch-Admin",
    "Service-Admin",
    "Part-Admin",
  ),
  getMaintenanceServices,
);

router.patch(
  "/:id",
  authorize("Developer", "Super-Admin"),
  updateMaintenanceService,
);

// Delete — reporters can withdraw their own request, Developer/Super-Admin can
// clear any. Both are additionally gated on the request still being "open";
// that check lives in the controller because it applies to every role.
router.delete(
  "/:id",
  authorize(
    "Developer",
    "Super-Admin",
    "Branch-Admin",
    "Service-Admin",
    "Part-Admin",
  ),
  deleteMaintenanceService,
);

export default router;
