import express from "express";
import { protect, authorize } from "../../middleware/authmiddleware";
import { ROLES } from "../../types/user.types";
import {
  askRag,
  reindexRag,
  getRagSources,
} from "../../controllers/Rag/rag.controller";

const router = express.Router();

router.use(protect);

// Shared RAG assistant — any authenticated role; per-role/branch scoping
// happens inside runRagQuery, not at the route level.
router.post("/query", askRag);

// Which sources the current role may query
router.get("/sources", getRagSources);

// Rebuild embeddings (Super-Admin only)
router.post("/reindex", authorize(ROLES.SUPER_ADMIN), reindexRag);

export default router;
