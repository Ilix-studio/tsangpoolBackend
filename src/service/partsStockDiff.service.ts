import mongoose from "mongoose";
import { PartsReportModel } from "../models/PartsReport";
import { PartsStockNormalizedRow as NormalizedRow } from "../utils/partsColumnMatcher";

/**
 * Upload-over-upload comparison for parts-stock uploads. A parts-stock file
 * is a full point-in-time snapshot of dealer inventory, so — unlike a
 * per-row content-hash dedup — this module compares the newly uploaded rows
 * against the *current* value per Part Number (the join key) and only
 * persists what actually changed. See controllers/Parts/partsUpload.controller.ts#importPartsReport.
 */

export interface SnapshotEntry {
  _id: mongoose.Types.ObjectId;
  normalized: NormalizedRow;
}

export type PartsSnapshotMap = Map<string, SnapshotEntry>;

export interface DiffRowEntry {
  rowData: Record<string, any>;
  normalized: NormalizedRow;
  needsReview: boolean;
}

export interface ChangedEntry extends DiffRowEntry {
  partNumber: string;
  previous: SnapshotEntry;
}

export interface RemovedEntry {
  partNumber: string;
  previous: SnapshotEntry;
}

export interface DiffResult {
  added: DiffRowEntry[];
  changed: ChangedEntry[];
  removed: RemovedEntry[];
  unchangedCount: number;
  addedCount: number;
  changedCount: number;
  removedCount: number;
}

/** The fields whose change actually matters for parts-stock (matches the fields kept on the records table). */
const COMPARE_FIELDS = ["quantity", "unitPrice", "inventoryLocationName"] as const;

/** Fetch the current (isActive && isCurrent) parts-stock rows for a branch, keyed by Part Number. */
export async function getCurrentSnapshot(
  branchId: string,
): Promise<PartsSnapshotMap> {
  const rows = await PartsReportModel.find(
    { branchId, isActive: true, isCurrent: true },
    { normalized: 1 },
  ).lean();

  const map: PartsSnapshotMap = new Map();
  for (const row of rows) {
    const partNumber = (row as any).normalized?.partNumber;
    if (partNumber) {
      map.set(partNumber, { _id: row._id as mongoose.Types.ObjectId, normalized: (row as any).normalized });
    }
  }
  return map;
}

function valuesDiffer(a: NormalizedRow, b: NormalizedRow): boolean {
  return COMPARE_FIELDS.some((f) => {
    const av = (a as any)[f];
    const bv = (b as any)[f];
    if (typeof av === "number" && typeof bv === "number") {
      return Math.abs(av - bv) > 1e-9;
    }
    return String(av ?? "") !== String(bv ?? "");
  });
}

/**
 * Compare freshly parsed rows against the current snapshot. Rows missing a
 * Part Number can't be matched to a prior value, so they're always treated
 * as "added" (never deduped) and left for the caller's normal needsReview
 * handling. Duplicate Part Numbers within the same file: last one wins.
 */
export function diffAgainstSnapshot(
  rows: DiffRowEntry[],
  snapshot: PartsSnapshotMap,
): DiffResult {
  const byPartNumber = new Map<string, DiffRowEntry>();
  const added: DiffRowEntry[] = [];

  for (const row of rows) {
    const partNumber = row.normalized.partNumber;
    if (!partNumber) {
      added.push(row);
      continue;
    }
    byPartNumber.set(partNumber, row);
  }

  const changed: ChangedEntry[] = [];
  let unchangedCount = 0;
  const seen = new Set<string>();

  for (const [partNumber, row] of byPartNumber) {
    seen.add(partNumber);
    const previous = snapshot.get(partNumber);
    if (!previous) {
      added.push(row);
    } else if (valuesDiffer(row.normalized, previous.normalized)) {
      changed.push({ ...row, partNumber, previous });
    } else {
      unchangedCount++;
    }
  }

  const removed: RemovedEntry[] = [];
  for (const [partNumber, previous] of snapshot) {
    if (!seen.has(partNumber)) removed.push({ partNumber, previous });
  }

  return {
    added,
    changed,
    removed,
    unchangedCount,
    addedCount: added.length,
    changedCount: changed.length,
    removedCount: removed.length,
  };
}

function rowRevenue(n: NormalizedRow): number {
  const qty = typeof n.quantity === "number" ? n.quantity : 0;
  const price = typeof n.unitPrice === "number" ? n.unitPrice : 0;
  return qty * price;
}

/** sum(quantity * unitPrice) over any set of normalized rows. */
export function computeRevenue(
  entries: Iterable<{ normalized: NormalizedRow }>,
): number {
  let total = 0;
  for (const e of entries) total += rowRevenue(e.normalized);
  return Math.round(total * 100) / 100;
}

/** Revenue after the diff is applied, derived in-memory from the same before/added/changed/removed data — no extra DB round-trip. */
export function computeRevenueAfter(
  revenueBefore: number,
  diff: DiffResult,
): number {
  let total = revenueBefore;
  for (const r of diff.removed) total -= rowRevenue(r.previous.normalized);
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
  quantity: "Qty",
  unitPrice: "Unit Price",
  inventoryLocationName: "Location",
};

export interface ChangesMarkdownInput {
  previousBatchId: string | null;
  previousDate: Date | null;
  diff: DiffResult;
  revenueBefore: number;
  revenueAfter: number;
}

/** Human-readable changelog for one parts-stock upload, shown on the frontend after commit and on the batch detail view. */
export function buildChangesMarkdown({
  previousBatchId,
  previousDate,
  diff,
  revenueBefore,
  revenueAfter,
}: ChangesMarkdownInput): string {
  const { added, changed, removed, unchangedCount } = diff;
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
  lines.push(`- **Added:** ${added.length} part(s)`);
  lines.push(`- **Changed:** ${changed.length} part(s)`);
  lines.push(`- **Removed:** ${removed.length} part(s)`);
  lines.push(`- **Unchanged:** ${unchangedCount} part(s)`);
  lines.push("");
  lines.push(
    `**Revenue:** ${fmtInr(revenueBefore)} → ${fmtInr(revenueAfter)} (**${sign}${fmtInr(
      Math.abs(delta),
    )}**${deltaPct !== null ? `, **${sign}${Math.abs(deltaPct)}%**` : ""})`,
  );

  if (changed.length > 0) {
    lines.push(
      "",
      "#### Changed parts",
      "",
      "| Part Number | Field | Old | New |",
      "|---|---|---|---|",
    );
    changed.slice(0, MARKDOWN_CAP).forEach((c) => {
      COMPARE_FIELDS.forEach((f) => {
        const oldV = (c.previous.normalized as any)[f];
        const newV = (c.normalized as any)[f];
        const differs =
          typeof oldV === "number" && typeof newV === "number"
            ? Math.abs(oldV - newV) > 1e-9
            : String(oldV ?? "") !== String(newV ?? "");
        if (differs) {
          lines.push(
            `| ${c.partNumber} | ${FIELD_LABELS[f]} | ${oldV ?? "—"} | ${newV ?? "—"} |`,
          );
        }
      });
    });
    if (changed.length > MARKDOWN_CAP) {
      lines.push("", `_...and ${changed.length - MARKDOWN_CAP} more changed part(s)_`);
    }
  }

  if (added.length > 0) {
    lines.push("", "#### Added parts", "");
    added.slice(0, MARKDOWN_CAP).forEach((a) => {
      const n = a.normalized;
      lines.push(
        `- ${n.partNumber ?? "(no part number)"} — ${n.description ?? ""} (Qty ${
          n.quantity ?? "—"
        }, Unit Price ${n.unitPrice != null ? fmtInr(n.unitPrice) : "—"})`,
      );
    });
    if (added.length > MARKDOWN_CAP) {
      lines.push("", `_...and ${added.length - MARKDOWN_CAP} more added part(s)_`);
    }
  }

  if (removed.length > 0) {
    lines.push("", "#### Removed parts", "");
    removed.slice(0, MARKDOWN_CAP).forEach((r) => {
      const n = r.previous.normalized;
      lines.push(
        `- ${r.partNumber} (was Qty ${n.quantity ?? "—"}, Unit Price ${
          n.unitPrice != null ? fmtInr(n.unitPrice) : "—"
        })`,
      );
    });
    if (removed.length > MARKDOWN_CAP) {
      lines.push("", `_...and ${removed.length - MARKDOWN_CAP} more removed part(s)_`);
    }
  }

  return lines.join("\n");
}
