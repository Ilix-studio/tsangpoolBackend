import mongoose from "mongoose";
import { UserRole } from "../../types/user.types";

export interface RagChunk {
  text: string;
  metadata: Record<string, any>;
}

/**
 * Every domain that should be retrievable through the shared RAG layer
 * registers one of these. Retrieval, scoping, context assembly, and the LLM
 * call all live in rag.service.ts and never import a Mongoose model
 * directly — they only ever go through getSource()/listSources() here.
 * Adding a new source means writing one new `sources/*.source.ts` file that
 * calls registerSource() and adding one import at the bottom of this file;
 * nothing in rag.service.ts, queryRouter.ts, or the embedding pipeline changes.
 */
export interface RetrievableSource<TDoc = any> {
  sourceType: string;
  model: mongoose.Model<TDoc>;
  displayName: string;
  /** Fields to select when reindexing, to keep the read payload small. */
  selectFields?: string;
  /**
   * Ref path(s) to populate before toChunk()/extractBranchId() run. Only
   * needed when branch (or other chunk text) isn't stored directly on this
   * model — e.g. CustomerVehicle has no branch field of its own and must
   * populate `stockConcept` to reach `stockStatus.branchId`.
   */
  populate?: string;

  /** Convert a Mongo doc into the text that gets embedded + citation metadata. */
  toChunk(doc: TDoc): RagChunk;

  /** Query filter selecting docs to (re)index for a given scope. */
  listForIndex(filter: {
    branchId?: string;
    since?: Date;
  }): mongoose.FilterQuery<TDoc>;

  scope: {
    branchField: string;
    allowedRoles: UserRole[];
    /** Normalizes a populated ref or raw ObjectId branch field to a string id. */
    extractBranchId(doc: TDoc): string | null;
  };
}

const registry = new Map<string, RetrievableSource>();

export function registerSource(source: RetrievableSource): void {
  if (registry.has(source.sourceType)) {
    throw new Error(`RAG source "${source.sourceType}" is already registered`);
  }
  registry.set(source.sourceType, source);
}

export function getSource(sourceType: string): RetrievableSource | undefined {
  return registry.get(sourceType);
}

export function listSources(): RetrievableSource[] {
  return Array.from(registry.values());
}

export function sourcesForRole(role: UserRole): RetrievableSource[] {
  return listSources().filter((s) => s.scope.allowedRoles.includes(role));
}

// Side-effect imports — each file below calls registerSource() on load.
// Register only the sources that exist and prove the pattern today; more
// domains (imported files, invoices, VAS, ...) drop in the same way later.
import "./sources/parts.source";
import "./sources/jobCard.source";
import "./sources/accidentReport.source";
import "./sources/jobcardRevenueImport.source";
import "./sources/stockAssign.source";
import "./sources/vasAssign.source";
