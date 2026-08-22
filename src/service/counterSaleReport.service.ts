import * as XLSX from "xlsx";
import { normalizeHeader } from "../utils/dataImport/columnMatcher";

export type SourceFormat = "xlsx" | "csv";

export interface ParsedRow {
  /** All columns of the row, keyed by (trimmed) header. */
  data: Record<string, any>;
  /** True for rows where a numeric/date field couldn't be parsed. */
  needsReview: boolean;
}

export interface ParsedReport {
  format: SourceFormat;
  columns: string[];
  rows: ParsedRow[];
}

export interface CuratedFields {
  cpotcOrderNumber: string;
  organization: string;
  accountName: string;
  purchaseOrderDate: Date | null;
  totalInvoice: number;
  needsReview: boolean;
}

/** Decide the source format from the uploaded file name / mimetype. */
export function detectSourceFormat(
  fileName: string,
  mimeType?: string,
): SourceFormat {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv") || mimeType === "text/csv") return "csv";
  return "xlsx";
}

/** Parse an XLSX or CSV buffer into row objects via SheetJS. */
function parseSpreadsheet(buffer: Buffer, format: SourceFormat): ParsedReport {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { format, columns: [], rows: [] };
  }
  const sheet = workbook.Sheets[sheetName];
  // defval: "" keeps empty cells so columns stay stable across rows.
  const records = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });

  const columns = records.length > 0 ? Object.keys(records[0]) : [];
  const rows: ParsedRow[] = records
    .filter((r) => Object.values(r).some((v) => String(v).trim() !== ""))
    .map((data) => ({ data, needsReview: false }));

  return { format, columns, rows };
}

/** Parse an uploaded counter sale report buffer into normalized rows. */
export async function parseCounterSaleReport(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ParsedReport> {
  const format = detectSourceFormat(fileName, mimeType);
  return parseSpreadsheet(buffer, format);
}

// The confirmed source headers this module curates onto typed fields.
// Matched via normalizeHeader, which lowercases, collapses runs of whitespace
// and turns . : / \ _ - into spaces — so "cpotc order #", "CPOTC-Order-#" and
// extra spacing all map fine. It does NOT delete whitespace or strip #, so
// "CPOTC Order#" (no space before the #) does not match and the row is
// rejected as missing its dedup key.
const CURATED_HEADERS = {
  cpotcOrderNumber: "CPOTC Order #",
  organization: "Organization",
  accountName: "Account Name",
  purchaseOrderDate: "Channel Partner  Purchase Order Date",
  totalInvoice: "Total Invoice",
};

function findByHeader(data: Record<string, any>, header: string): any {
  const target = normalizeHeader(header);
  const key = Object.keys(data).find((k) => normalizeHeader(k) === target);
  return key ? data[key] : undefined;
}

function parseNumeric(raw: any): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const cleaned = String(raw).replace(/[,₹$\s]/g, "").trim();
  if (cleaned === "") return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseFlexibleDate(raw: any): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const str = String(raw).trim();

  // DD-MM-YYYY / DD/MM/YYYY (and 2-digit year variants) — the real dealer
  // export format. Must be tried BEFORE the generic `new Date(str)` fallback,
  // which happily (mis)parses ambiguous dates as US-style MM-DD-YYYY.
  const match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const direct = new Date(str);
  if (!Number.isNaN(direct.getTime())) return direct;

  return undefined;
}

/**
 * Extract the four curated display fields + dedup key from a raw parsed row.
 * Throws if the dedup key (CPOTC Order #) is blank — such a row can't be
 * deduped or usefully displayed, so it should be rejected per-row rather
 * than silently imported.
 */
export function extractCuratedFields(data: Record<string, any>): CuratedFields {
  const cpotcOrderNumber = String(
    findByHeader(data, CURATED_HEADERS.cpotcOrderNumber) ?? "",
  ).trim();
  if (!cpotcOrderNumber) {
    throw new Error('Missing "CPOTC Order #" — required for de-duplication');
  }

  const organization = String(
    findByHeader(data, CURATED_HEADERS.organization) ?? "",
  ).trim();
  const accountName = String(
    findByHeader(data, CURATED_HEADERS.accountName) ?? "",
  ).trim();

  let needsReview = false;

  const rawDate = findByHeader(data, CURATED_HEADERS.purchaseOrderDate);
  const purchaseOrderDate = parseFlexibleDate(rawDate);
  if (purchaseOrderDate === undefined && String(rawDate ?? "").trim() !== "") {
    needsReview = true;
  }

  const rawInvoice = findByHeader(data, CURATED_HEADERS.totalInvoice);
  const totalInvoice = parseNumeric(rawInvoice);
  if (totalInvoice === undefined && String(rawInvoice ?? "").trim() !== "") {
    needsReview = true;
  }

  return {
    cpotcOrderNumber,
    organization,
    accountName,
    purchaseOrderDate: purchaseOrderDate ?? null,
    totalInvoice: totalInvoice ?? 0,
    needsReview,
  };
}
