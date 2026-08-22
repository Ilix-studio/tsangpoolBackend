import express from "express";

import {
  getScanFleetProfile,
  activateScanFleetToken,
} from "../../controllers/Scanfleet/scanfleet.controller";

const router = express.Router();

router.get("/profile", getScanFleetProfile);
router.post("/activate", activateScanFleetToken);

export default router;
