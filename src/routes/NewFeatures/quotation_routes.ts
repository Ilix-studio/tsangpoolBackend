// routes/NewFeatures/quotation_routes.ts
import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import {
  createQuotation,
  getQuotations,
  getQuotationById,
  updateQuotation,
  deleteQuotation,
  bulkExpireQuotationsBeforeDate,
  getPublicQuotation,
} from "../../controllers/NewFeatures/quotation_controller";

const router = express.Router();

// Anonymous share-link read — must stay above router.use(protect) below.
router.get("/public/:quotationNo/:token", getPublicQuotation);

router.use(protect);
// Super-Admin included so bulkExpireQuotationsBeforeDate's body.branch path
// (and the isAdmin() branching already in getQuotations/getQuotationById/
// updateQuotation/deleteQuotation) is actually reachable.
router.use(authorize("Branch-Admin", "Super-Admin"));

router.post("/", createQuotation);
router.get("/", getQuotations);
// Literal path — must stay above the "/:id" routes below, or Express would
// match "bulk-expire" as an :id and hit updateQuotation instead.
router.patch("/bulk-expire", bulkExpireQuotationsBeforeDate);
router.get("/:id", getQuotationById);
router.patch("/:id", updateQuotation);
router.delete("/:id", deleteQuotation);

export default router;
