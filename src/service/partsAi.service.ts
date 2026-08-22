import Anthropic from "@anthropic-ai/sdk";
import { PartsReportModel } from "../models/PartsReport";
import { PartsReportBatchModel } from "../models/PartsReportBatch";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Build a compact, aggregate-only snapshot of parts data for the model.
 * We deliberately send aggregates (totals, monthly counts, recent batches,
 * a small sample of rows) rather than every stored row, to control token cost.
 */
async function buildContext(branchId?: string): Promise<string> {
  const match: Record<string, any> = { isActive: true };
  if (branchId) match.branchId = branchId;
  // Totals and sample rows reflect *current* state — a row superseded by a
  // later upload (isCurrent: false) shouldn't inflate counts or be quoted
  // back to the user as if it were still accurate.
  const currentMatch = { ...match, isCurrent: { $ne: false } };

  const [totals, batchCount, monthly, recentBatches, sampleDocs] = await Promise.all([
    PartsReportModel.aggregate([
      { $match: currentMatch },
      {
        $group: {
          _id: null,
          totalParts: { $sum: 1 },
          reviewParts: {
            $sum: { $cond: [{ $eq: ["$needsReview", true] }, 1, 0] },
          },
          branches: { $addToSet: "$branchId" },
        },
      },
    ]),
    PartsReportBatchModel.countDocuments(match),
    PartsReportModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            y: { $year: "$importDate" },
            m: { $month: "$importDate" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.y": 1, "_id.m": 1 } },
      { $limit: 24 },
    ]),
    PartsReportModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$importBatch",
          fileName: { $first: "$fileName" },
          sourceFormat: { $first: "$sourceFormat" },
          importDate: { $first: "$importDate" },
          count: { $sum: 1 },
        },
      },
      { $sort: { importDate: -1 } },
      { $limit: 10 },
    ]),
    PartsReportModel.find(currentMatch)
      .sort({ createdAt: -1 })
      .limit(15)
      .select("rowData detectedColumns sourceFormat needsReview")
      .lean(),
  ]);

  const t = totals[0] ?? { totalParts: 0, reviewParts: 0, branches: [] };

  return JSON.stringify(
    {
      scope: branchId ? `branch ${branchId}` : "all branches",
      totals: {
        totalParts: t.totalParts,
        needsReview: t.reviewParts,
        branchCount: t.branches.length,
        batchCount,
      },
      monthlyCounts: monthly.map((m) => ({
        year: m._id.y,
        month: m._id.m,
        count: m.count,
      })),
      recentUploads: recentBatches.map((b) => ({
        batchId: b._id,
        fileName: b.fileName,
        format: b.sourceFormat,
        importDate: b.importDate,
        rows: b.count,
      })),
      sampleRows: sampleDocs.map((d: any) => d.rowData),
    },
    null,
    2,
  );
}

const SYSTEM_PROMPT = `You are a data analyst assistant for a Honda motorcycle dealership's parts department.
You are given a JSON snapshot of aggregated parts-report data (totals, monthly upload counts, recent upload batches, and a small sample of raw rows).
Answer ONLY from the provided data. If the data does not contain the answer, say so plainly — do not invent figures.
Be concise and specific: cite concrete numbers from the snapshot. Format currency and counts clearly.
The column names in the raw rows come from the dealer's uploaded reports and may vary.`;

export interface PartsAiResult {
  answer: string;
  model: string;
}

/**
 * Generate a summary (mode "summary") or answer a question (mode "chat")
 * grounded in the aggregated parts data.
 */
export async function runPartsAi(opts: {
  mode: "summary" | "chat";
  question?: string;
  branchId?: string;
}): Promise<PartsAiResult> {
  const context = await buildContext(opts.branchId);

  const userText =
    opts.mode === "summary"
      ? "Give a short executive summary of the dealership's parts data: overall volume, notable trends across the monthly counts, the most recent uploads, and anything that needs attention (e.g. rows flagged for review)."
      : (opts.question || "").trim();

  if (opts.mode === "chat" && !userText) {
    throw new Error("A question is required in chat mode");
  }

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here is the current parts data snapshot:\n\n${context}\n\n---\n\n${userText}`,
      },
    ],
  });

  const answer = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { answer, model: MODEL };
}
