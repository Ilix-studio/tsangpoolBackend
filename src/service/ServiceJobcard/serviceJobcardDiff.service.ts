import mongoose from "mongoose";
import { ServiceJobcardRecordModel } from "../../models/ServiceJobcard/ServiceJobcardRecord";
import { ServiceJobcardNormalizedRow as NormalizedRow } from "../../utils/serviceJobcardColumnMatcher";

/**
 * Upload-over-upload comparison for service-jobcard uploads, keyed by Job
 * Card Number. Unlike parts-stock (a full point-in-time inventory snapshot,
 * diffed three ways including "removed"), a job-card export is a period's
 * newly-closed cards, not a full historical re-export — so there is no
 * "removed" bucket here: a job card's absence from a later upload carries no
 * meaning. A row is "added" (new Job Card Number), "changed" (previously
 * seen, now with different data — e.g. a revenue correction), or
 * "unchanged" (skipped, not re-persisted, not re-processed).
 * See controllers/ServiceJobcard/serviceJobcardUpload.controller.ts.
 */

export interface SnapshotEntry {
  _id: mongoose.Types.ObjectId;
  normalized: NormalizedRow;
}

export type JobcardSnapshotMap = Map<string, SnapshotEntry>;

export interface DiffRowEntry {
  rowData: Record<string, any>;
  normalized: NormalizedRow;
  needsReview: boolean;
}

export interface ChangedEntry extends DiffRowEntry {
  jobCardNumber: string;
  previous: SnapshotEntry;
}

export interface DiffResult {
  added: DiffRowEntry[];
  changed: ChangedEntry[];
  unchangedCount: number;
  addedCount: number;
  changedCount: number;
}

/** Fetch the current (isActive && isCurrent) service-jobcard rows for a branch, keyed by Job Card Number. */
export async function getCurrentSnapshot(
  branchId: string,
): Promise<JobcardSnapshotMap> {
  const rows = await ServiceJobcardRecordModel.find(
    { branchId, isActive: true, isCurrent: true },
    { normalized: 1 },
  ).lean();

  const map: JobcardSnapshotMap = new Map();
  for (const row of rows) {
    const jobCardNumber = (row as any).normalized?.jobCardNumber;
    if (jobCardNumber) {
      map.set(jobCardNumber, {
        _id: row._id as mongoose.Types.ObjectId,
        normalized: (row as any).normalized,
      });
    }
  }
  return map;
}

/** Deterministic (sorted-key) JSON serialization, for whole-object equality checks. */
function stableStringify(obj: Record<string, any>): string {
  const sortedKeys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const normalized: Record<string, any> = {};
  for (const k of sortedKeys) normalized[k] = obj[k];
  return JSON.stringify(normalized);
}

function valuesDiffer(a: NormalizedRow, b: NormalizedRow): boolean {
  return stableStringify(a) !== stableStringify(b);
}

/**
 * Compare freshly parsed rows against the current snapshot. Rows missing a
 * Job Card Number can't be matched to a prior value, so they're always
 * treated as "added" (never deduped). Duplicate Job Card Numbers within the
 * same file: last one wins.
 */
export function diffAgainstSnapshot(
  rows: DiffRowEntry[],
  snapshot: JobcardSnapshotMap,
): DiffResult {
  const byJobCardNumber = new Map<string, DiffRowEntry>();
  const added: DiffRowEntry[] = [];

  for (const row of rows) {
    const jobCardNumber = row.normalized.jobCardNumber;
    if (!jobCardNumber) {
      added.push(row);
      continue;
    }
    byJobCardNumber.set(jobCardNumber, row);
  }

  const changed: ChangedEntry[] = [];
  let unchangedCount = 0;

  for (const [jobCardNumber, row] of byJobCardNumber) {
    const previous = snapshot.get(jobCardNumber);
    if (!previous) {
      added.push(row);
    } else if (valuesDiffer(row.normalized, previous.normalized)) {
      changed.push({ ...row, jobCardNumber, previous });
    } else {
      unchangedCount++;
    }
  }

  return {
    added,
    changed,
    unchangedCount,
    addedCount: added.length,
    changedCount: changed.length,
  };
}

function rowRevenue(n: NormalizedRow): number {
  return typeof n.totalJobCardRevenue === "number" ? n.totalJobCardRevenue : 0;
}

/** sum(totalJobCardRevenue) over any set of normalized rows. */
export function computeRevenue(
  entries: Iterable<{ normalized: NormalizedRow }>,
): number {
  let total = 0;
  for (const e of entries) total += rowRevenue(e.normalized);
  return Math.round(total * 100) / 100;
}

/** Revenue after the diff is applied, derived in-memory — no extra DB round-trip. */
export function computeRevenueAfter(
  revenueBefore: number,
  diff: DiffResult,
): number {
  let total = revenueBefore;
  for (const c of diff.changed) {
    total -= rowRevenue(c.previous.normalized);
    total += rowRevenue(c.normalized);
  }
  for (const a of diff.added) total += rowRevenue(a.normalized);
  return Math.round(total * 100) / 100;
}

const MARKDOWN_CAP = 30;

function fmtInr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const FIELD_LABELS: Record<string, string> = {
  totalJobCardRevenue: "Total Revenue",
  labourRevenue: "Labour Revenue",
  partsRevenue: "Parts Revenue",
  lubesRevenue: "Lubes Revenue",
  accessoriesRevenue: "Accessories Revenue",
  currentKms: "Current KMs",
  serviceType: "Service Type",
  technicianName: "Technician",
};

export interface ChangesMarkdownInput {
  previousBatchId: string | null;
  previousDate: Date | null;
  diff: DiffResult;
  revenueBefore: number;
  revenueAfter: number;
  autoRegistration: {
    vehicleMatchedServiceUpdated: number;
    customerCreatedVehicleCreated: number;
    customerMatchedVehicleCreated: number;
    conflicts: number;
    skipped: number;
    freeServicesDisabled: number;
    nameMismatches: number;
  };
}

/** Human-readable changelog for one service-jobcard upload. */
export function buildChangesMarkdown({
  previousBatchId,
  previousDate,
  diff,
  revenueBefore,
  revenueAfter,
  autoRegistration,
}: ChangesMarkdownInput): string {
  const { added, changed, unchangedCount } = diff;
  const delta = Math.round((revenueAfter - revenueBefore) * 100) / 100;
  const deltaPct =
    revenueBefore > 0 ? Math.round((delta / revenueBefore) * 1000) / 10 : null;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";

  const lines: string[] = [];
  lines.push(
    previousBatchId
      ? `### Changes vs previous upload (\`${previousBatchId}\`${
          previousDate ? ` — ${previousDate.toISOString().slice(0, 10)}` : ""
        })`
      : "### Initial upload",
  );
  lines.push("");
  lines.push(`- **Added:** ${added.length} job card(s)`);
  lines.push(`- **Changed:** ${changed.length} job card(s)`);
  lines.push(`- **Unchanged:** ${unchangedCount} job card(s)`);
  lines.push("");
  lines.push(
    `**Revenue:** ${fmtInr(revenueBefore)} → ${fmtInr(revenueAfter)} (**${sign}${fmtInr(
      Math.abs(delta),
    )}**${deltaPct !== null ? `, **${sign}${Math.abs(deltaPct)}%**` : ""})`,
  );
  lines.push("");
  lines.push(
    `**Auto-registration:** ${autoRegistration.vehicleMatchedServiceUpdated} vehicle(s) updated, ` +
      `${autoRegistration.customerCreatedVehicleCreated} new customer+vehicle, ` +
      `${autoRegistration.customerMatchedVehicleCreated} matched customer + new vehicle, ` +
      `${autoRegistration.conflicts} conflict(s), ${autoRegistration.skipped} skipped, ` +
      `${autoRegistration.nameMismatches} name mismatch(es) flagged for review.`,
  );

  if (changed.length > 0) {
    lines.push(
      "",
      "#### Changed job cards",
      "",
      "| Job Card # | Field | Old | New |",
      "|---|---|---|---|",
    );
    changed.slice(0, MARKDOWN_CAP).forEach((c) => {
      Object.keys(FIELD_LABELS).forEach((f) => {
        const oldV = (c.previous.normalized as any)[f];
        const newV = (c.normalized as any)[f];
        const differs =
          typeof oldV === "number" && typeof newV === "number"
            ? Math.abs(oldV - newV) > 1e-9
            : String(oldV ?? "") !== String(newV ?? "");
        if (differs) {
          lines.push(
            `| ${c.jobCardNumber} | ${FIELD_LABELS[f]} | ${oldV ?? "—"} | ${newV ?? "—"} |`,
          );
        }
      });
    });
    if (changed.length > MARKDOWN_CAP) {
      lines.push("", `_...and ${changed.length - MARKDOWN_CAP} more changed job card(s)_`);
    }
  }

  if (added.length > 0) {
    lines.push("", "#### Added job cards", "");
    added.slice(0, MARKDOWN_CAP).forEach((a) => {
      const n = a.normalized;
      lines.push(
        `- ${n.jobCardNumber ?? "(no job card number)"} — ${n.customerName ?? ""} ` +
          `(${n.modelName ?? "—"}, Total Revenue ${
            n.totalJobCardRevenue != null ? fmtInr(n.totalJobCardRevenue) : "—"
          })`,
      );
    });
    if (added.length > MARKDOWN_CAP) {
      lines.push("", `_...and ${added.length - MARKDOWN_CAP} more added job card(s)_`);
    }
  }

  return lines.join("\n");
}
