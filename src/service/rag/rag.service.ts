import Anthropic from "@anthropic-ai/sdk";
import { AuthenticatedUser, getUserRole } from "../../types/user.types";
import { resolveBranchScope, BranchScope } from "./scope";
import { classifyQuery, QueryPath } from "./queryRouter";
import { embedText, embedTexts } from "./embedding.service";
import {
  getSource,
  listSources,
  sourcesForRole,
  RetrievableSource,
} from "./sourceRegistry";
import { EmbeddingChunkModel } from "../../models/RAG/EmbeddingChunk";
import logger from "../../utils/logger";
import { computePartsStats } from "../../controllers/Parts/partsStats.controller";
import { computeSalesTimeseries } from "../../controllers/ServiceJobcard/serviceJobcardSalesTimeseries.controller";
import {
  computeJobCardStats,
  computeAccidentReportStats,
  computeStockAssignStats,
  computeVasAssignStats,
} from "./statsAdapters";
import { dashboardSpecFor, DashboardSpec } from "./dashboardSpec";

// Cheap/fast model for the structured path — the task is just phrasing
// already-computed numbers into a sentence with a citation. Kept separate
// from partsAi.service.ts's ANTHROPIC_MODEL so the existing Parts AI feature
// is unaffected by this generalization.
const STRUCTURED_MODEL =
  process.env.ANTHROPIC_RAG_STRUCTURED_MODEL || "claude-haiku-4-5";
// Stronger model for the semantic path — needs real reading comprehension
// over multiple retrieved chunks.
const SEMANTIC_MODEL =
  process.env.ANTHROPIC_RAG_SEMANTIC_MODEL || "claude-sonnet-5";

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

async function narrate(
  model: string,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const message = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface RagCitation {
  sourceType: string;
  sourceId: string;
  displayName: string;
  snippet: string;
}

export interface RagQueryResult {
  answer: string;
  citations: RagCitation[];
  usedPath: QueryPath;
  model: string;
  /** Chart-ready spec built from the same grounded aggregates used to
   * narrate the answer — present only when the structured path computed at
   * least one stat with a known chart mapping (see dashboardSpec.ts). */
  dashboardSpec?: DashboardSpec;
}

export interface RagQueryOptions {
  question: string;
  user: AuthenticatedUser;
  branchId?: string;
  sourceTypes?: string[];
}

// ─── Structured path ──────────────────────────────────────────────────────────

const STRUCTURED_STATS_COMPUTERS: Record<
  string,
  (scope: BranchScope) => Promise<any>
> = {
  parts: (scope) => computePartsStats(scope, new Date().getFullYear()),
  "jobcard-live": (scope) =>
    computeJobCardStats(scope, new Date().getFullYear()),
  "accident-report": (scope) => computeAccidentReportStats(scope),
  // Reuses the DataImport module's own sales-timeseries aggregate rather
  // than re-implementing revenue rollups over ImportedRow.
  "jobcard-revenue-import": (scope) =>
    computeSalesTimeseries(scope, { granularity: "month" }),
  "stock-assign": (scope) =>
    computeStockAssignStats(scope, new Date().getFullYear()),
  "vas-assign": (scope) =>
    computeVasAssignStats(scope, new Date().getFullYear()),
};

const STRUCTURED_SYSTEM_PROMPT = `You are a data analyst assistant for a Honda motorcycle dealership.
You are given the results of live aggregate database queries (exact counts, sums, and monthly trends) as JSON.
Answer ONLY using these numbers — do not estimate or invent figures.
Be concise, cite the concrete numbers, and mention which data source (parts, job cards, accident reports) each figure comes from.`;

async function computeStructuredContext(
  scope: BranchScope,
  sources: RetrievableSource[],
): Promise<{ text: string; citations: RagCitation[]; dashboardSpec?: DashboardSpec }> {
  const relevant = sources.filter((s) => STRUCTURED_STATS_COMPUTERS[s.sourceType]);

  const results = await Promise.all(
    relevant.map(async (s) => ({
      sourceType: s.sourceType,
      stats: await STRUCTURED_STATS_COMPUTERS[s.sourceType](scope),
    })),
  );

  const citations: RagCitation[] = results.map((r) => ({
    sourceType: "aggregate",
    sourceId: r.sourceType,
    displayName: `Live aggregate query (${getSource(r.sourceType)?.displayName ?? r.sourceType})`,
    snippet: "Computed directly from the database — not a retrieved document.",
  }));

  // One chart per answer, not a bundle — take the first source with a known
  // chart mapping, mirroring how the answer itself narrates by source order.
  let dashboardSpec: DashboardSpec | undefined;
  for (const r of results) {
    const spec = dashboardSpecFor(r.sourceType, r.stats);
    if (spec) {
      dashboardSpec = spec;
      break;
    }
  }

  return { text: JSON.stringify(results, null, 2), citations, dashboardSpec };
}

// ─── Semantic path ────────────────────────────────────────────────────────────

const TOP_K = 8;
const NUM_CANDIDATES = 150;

const SEMANTIC_SYSTEM_PROMPT = `You are a data analyst assistant for a Honda motorcycle dealership.
You are given a numbered list of retrieved records relevant to the user's question.
Answer ONLY from these records — if they don't contain the answer, say so plainly.
For every claim, cite the record number(s) you used in square brackets, e.g. [1], [2].
Do not perform arithmetic across multiple records — if the question needs a computed total or count, say that a live aggregate query is needed instead.`;

async function retrieveSemanticContext(
  question: string,
  scope: BranchScope,
  role: string,
  sources: RetrievableSource[],
): Promise<{ text: string; citations: RagCitation[]; unavailable?: boolean }> {
  const sourceTypes = sources.map((s) => s.sourceType);

  // Scope BEFORE search: branchId/allowedRoles/sourceType are pre-filter
  // clauses evaluated by Atlas before the ANN search runs, never applied
  // after retrieval.
  const filterClauses: Record<string, any>[] = [
    { allowedRoles: { $in: [role] } },
    { sourceType: { $in: sourceTypes } },
  ];
  if (scope !== "all") {
    filterClauses.push({ branchId: scope.toString() });
  }

  // Cheap existence check before spending an embedding API call: semantic
  // retrieval only means anything once `reindexRag` has actually populated
  // EmbeddingChunk for this scope, and Atlas Vector Search index has been
  // created. Skipping this avoids burning embedding-API quota (and getting
  // rate-limited) on a search that has nothing to search against.
  const hasChunks = await EmbeddingChunkModel.exists({ $and: filterClauses });
  if (!hasChunks) {
    return { text: "", citations: [], unavailable: true };
  }

  try {
    const queryEmbedding = await embedText(question, "query");

    const results = await EmbeddingChunkModel.aggregate([
      {
        $vectorSearch: {
          index: "rag_vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: NUM_CANDIDATES,
          limit: TOP_K,
          filter: { $and: filterClauses },
        },
      },
      {
        $project: {
          text: 1,
          sourceType: 1,
          sourceId: 1,
          joinKeys: 1,
        },
      },
    ]);

    const citations: RagCitation[] = results.map((r: any) => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId.toString(),
      displayName: getSource(r.sourceType)?.displayName ?? r.sourceType,
      snippet: String(r.text).slice(0, 160),
    }));

    const text = results
      .map(
        (r: any, i: number) => `[${i + 1}] (${r.sourceType}:${r.sourceId}) ${r.text}`,
      )
      .join("\n");

    return { text, citations };
  } catch (error) {
    // Embedding API/vector-search failure (rate limit, missing Atlas index,
    // network) — degrade instead of failing the whole request.
    logger.warn(
      `RAG semantic retrieval unavailable, falling back to structured-only: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    return { text: "", citations: [], unavailable: true };
  }
}

// ─── Ambiguous path ───────────────────────────────────────────────────────────

const AMBIGUOUS_SYSTEM_PROMPT = `You are a data analyst assistant for a Honda motorcycle dealership.
You are given (a) the results of live aggregate database queries (exact numbers) and (b) a numbered list of retrieved records for narrative context.
If both a computed aggregate number and a number derivable from the retrieved records describe the same figure, always state the aggregate number — the retrieved records are for narrative/citation context only, never for arithmetic.
Cite retrieved records in square brackets, e.g. [1]. Be concise.`;

// ─── Core entry point ─────────────────────────────────────────────────────────

export async function runRagQuery(
  opts: RagQueryOptions,
): Promise<RagQueryResult> {
  const { question, user } = opts;
  if (!question?.trim()) {
    throw new Error("A question is required");
  }

  const scope = resolveBranchScope(user, opts.branchId);
  if (scope === null) {
    throw new Error("Branch could not be resolved");
  }

  const role = getUserRole(user);
  const sources = sourcesForRole(role).filter(
    (s) => !opts.sourceTypes || opts.sourceTypes.includes(s.sourceType),
  );
  if (sources.length === 0) {
    throw new Error("No data sources are available for this role/selection");
  }

  const path = classifyQuery(question);

  if (path === "structured") {
    const ctx = await computeStructuredContext(scope, sources);
    const answer = await narrate(
      STRUCTURED_MODEL,
      STRUCTURED_SYSTEM_PROMPT,
      `${ctx.text}\n\n---\n\n${question}`,
    );
    return {
      answer,
      citations: ctx.citations,
      usedPath: "structured",
      model: STRUCTURED_MODEL,
      dashboardSpec: ctx.dashboardSpec,
    };
  }

  if (path === "semantic") {
    const ctx = await retrieveSemanticContext(question, scope, role, sources);
    if (ctx.unavailable) {
      return {
        answer:
          "I don't have any indexed records to search yet, so I can't answer lookup-style questions right now. Try a stats-style question instead (e.g. \"how many...\", \"total revenue...\", \"this month...\").",
        citations: [],
        usedPath: "semantic",
        model: SEMANTIC_MODEL,
      };
    }
    const answer = await narrate(
      SEMANTIC_MODEL,
      SEMANTIC_SYSTEM_PROMPT,
      `${ctx.text}\n\n---\n\n${question}`,
    );
    return { answer, citations: ctx.citations, usedPath: "semantic", model: SEMANTIC_MODEL };
  }

  // ambiguous — run both in parallel, single synthesis call with numeric precedence
  const [structuredCtx, semanticCtx] = await Promise.all([
    computeStructuredContext(scope, sources),
    retrieveSemanticContext(question, scope, role, sources),
  ]);

  // No indexed records to search — fall back to the structured aggregates
  // alone rather than failing the whole request.
  const combinedText = semanticCtx.unavailable
    ? `Live aggregate results:\n${structuredCtx.text}`
    : `Live aggregate results:\n${structuredCtx.text}\n\n` +
      `Retrieved records:\n${semanticCtx.text}`;

  const answer = await narrate(
    SEMANTIC_MODEL,
    AMBIGUOUS_SYSTEM_PROMPT,
    `${combinedText}\n\n---\n\n${question}`,
  );

  return {
    answer,
    citations: semanticCtx.unavailable
      ? structuredCtx.citations
      : [...structuredCtx.citations, ...semanticCtx.citations],
    usedPath: "ambiguous",
    model: SEMANTIC_MODEL,
    dashboardSpec: structuredCtx.dashboardSpec,
  };
}

// ─── Reindexing ───────────────────────────────────────────────────────────────

const REINDEX_BATCH_SIZE = 200;

export interface ReindexResult {
  sourceType: string;
  indexed: number;
}

/**
 * Rebuilds embeddings for one source (or all sources) within an optional
 * branch/since scope. Explicit and admin-triggered for v1 — see the RAG
 * design notes on the freshness/complexity tradeoff vs. automatic write hooks.
 */
export async function reindexSources(opts: {
  sourceType?: string;
  branchId?: string;
  since?: Date;
}): Promise<ReindexResult[]> {
  const sources = opts.sourceType
    ? [getSource(opts.sourceType)].filter((s): s is RetrievableSource => !!s)
    : listSources();

  if (sources.length === 0) {
    throw new Error(`Unknown RAG source type: ${opts.sourceType}`);
  }

  const results: ReindexResult[] = [];

  for (const source of sources) {
    const filter = source.listForIndex({
      branchId: opts.branchId,
      since: opts.since,
    });

    let indexed = 0;
    let skip = 0;

    for (;;) {
      let query = source.model.find(filter);
      if (source.selectFields) {
        query = query.select(source.selectFields);
      }
      if (source.populate) {
        query = query.populate(source.populate);
      }
      const docs: any[] = await query
        .skip(skip)
        .limit(REINDEX_BATCH_SIZE)
        .lean();

      if (docs.length === 0) break;

      const candidates = docs
        .map((doc) => {
          const { text, metadata } = source.toChunk(doc);
          const branchId = source.scope.extractBranchId(doc);
          return { doc, text, metadata, branchId };
        })
        .filter((c) => !!c.branchId); // skip docs with no resolvable branch

      if (candidates.length > 0) {
        const embeddings = await embedTexts(
          candidates.map((c) => c.text),
          "document",
        );

        await EmbeddingChunkModel.bulkWrite(
          candidates.map((c, i) => ({
            updateOne: {
              filter: { chunkId: `${source.sourceType}:${c.doc._id}` },
              update: {
                $set: {
                  chunkId: `${source.sourceType}:${c.doc._id}`,
                  sourceType: source.sourceType,
                  sourceId: c.doc._id,
                  branchId: c.branchId,
                  allowedRoles: source.scope.allowedRoles,
                  text: c.text,
                  embedding: embeddings[i],
                  joinKeys: c.metadata,
                },
              },
              upsert: true,
            },
          })),
        );
      }

      indexed += docs.length;
      skip += REINDEX_BATCH_SIZE;
    }

    results.push({ sourceType: source.sourceType, indexed });
  }

  return results;
}
