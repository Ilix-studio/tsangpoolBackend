import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { runRagQuery, reindexSources } from "../../service/rag/rag.service";
import { sourcesForRole } from "../../service/rag/sourceRegistry";
import { getUserRole } from "../../types/user.types";
import logger from "../../utils/logger";

/**
 * @desc    Ask the shared RAG assistant a natural-language question
 * @route   POST /api/rag/query
 * @access  Any authenticated role (scoping happens per-role inside runRagQuery)
 */
export const askRag = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized");
  }

  const { question, branchId, sourceTypes } = req.body as {
    question?: string;
    branchId?: string;
    sourceTypes?: string[];
  };

  if (!question || !question.trim()) {
    res.status(400);
    throw new Error("question is required");
  }

  if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
    res.status(400);
    throw new Error("Invalid branchId");
  }

  if (sourceTypes && !Array.isArray(sourceTypes)) {
    res.status(400);
    throw new Error("sourceTypes must be an array");
  }

  try {
    const result = await runRagQuery({
      question,
      user: req.user,
      branchId,
      sourceTypes,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "RAG request failed";
    logger.error("RAG query failed:", msg);
    const status =
      msg.includes("required") ||
      msg.includes("Branch could not be resolved") ||
      msg.includes("No data sources")
        ? 400
        : 500;
    res.status(status);
    throw new Error(msg);
  }
});

/**
 * @desc    Rebuild embeddings for one or all registered RAG sources
 * @route   POST /api/rag/reindex
 * @access  Super-Admin
 */
export const reindexRag = asyncHandler(async (req: Request, res: Response) => {
  const { sourceType, branchId, since } = req.body as {
    sourceType?: string;
    branchId?: string;
    since?: string;
  };

  if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
    res.status(400);
    throw new Error("Invalid branchId");
  }

  try {
    const result = await reindexSources({
      sourceType,
      branchId,
      since: since ? new Date(since) : undefined,
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Reindex failed";
    logger.error("RAG reindex failed:", msg);
    res.status(msg.includes("Unknown RAG source type") ? 400 : 500);
    throw new Error(msg);
  }
});

/**
 * @desc    List the RAG sources the current role is allowed to query
 * @route   GET /api/rag/sources
 * @access  Any authenticated role
 */
export const getRagSources = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized");
    }

    const role = getUserRole(req.user);
    const data = sourcesForRole(role).map((s) => ({
      sourceType: s.sourceType,
      displayName: s.displayName,
    }));

    res.status(200).json({ success: true, data });
  },
);
