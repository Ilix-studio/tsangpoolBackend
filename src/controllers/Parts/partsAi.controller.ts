import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { runPartsAi } from "../../service/partsAi.service";
import { isAdmin } from "../../types/user.types";
import logger from "../../utils/logger";

/**
 * @desc    Ask the AI assistant to summarize / answer questions about parts data
 * @route   POST /api/parts/ai
 * @access  Super-Admin
 */
export const askPartsAi = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user || !isAdmin(req.user)) {
    res.status(403);
    throw new Error("Only Super-Admin can use the parts AI assistant");
  }

  const { question, mode = "chat", branchId } = req.body as {
    question?: string;
    mode?: "summary" | "chat";
    branchId?: string;
  };

  if (mode !== "summary" && mode !== "chat") {
    res.status(400);
    throw new Error("mode must be 'summary' or 'chat'");
  }

  if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
    res.status(400);
    throw new Error("Invalid branchId");
  }

  try {
    const result = await runPartsAi({ mode, question, branchId });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "AI request failed";
    logger.error("Parts AI request failed:", msg);
    // Config/key problems are our fault (500); a missing question is the caller's (400).
    const status = msg.includes("question is required") ? 400 : 500;
    res.status(status);
    throw new Error(msg);
  }
});
