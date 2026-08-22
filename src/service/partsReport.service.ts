import crypto from "crypto";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";

export type SourceFormat = "xlsx" | "csv" | "pdf";

export interface ParsedRow {
  /** All columns of the row, keyed by (trimmed) header. */
  data: Record<string, any>;
  /** True for low-confidence rows (currently: everything parsed from PDF). */
  needsReview: boolean;
}

export interface ParsedReport {
  format: SourceFormat;
  columns: string[];
  rows: ParsedRow[];
}

/** Decide the source format from the uploaded file name / mimetype. */
export function detectSourceFormat(
  fileName: string,
  mimeType?: string,
): SourceFormat {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".csv") || mimeType === "text/csv") return "csv";
  return "xlsx";
}

/**
 * Deterministic hash of a row's *content*, independent of key order, used as
 * the interim de-duplication key. Values are normalized (trimmed, lowercased)
 * so trivial whitespace/case differences don't defeat dedup.
 */
export function computeRowHash(data: Record<string, any>): string {
  const normalized = Object.keys(data)
    .sort()
    .map((k) => `${k.trim().toLowerCase()}=${String(data[k] ?? "").trim().toLowerCase()}`)
    .join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Parse an XLSX or CSV buffer into row objects via SheetJS. */
function parseSpreadsheet(
  buffer: Buffer,
  format: SourceFormat,
): ParsedReport {
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

/**
 * Best-effort PDF extraction: pull text, then split whitespace-delimited lines
 * into cells. This is inherently unreliable, so every row is flagged
 * `needsReview` for manual confirmation on the frontend.
 */
async function parsePdf(buffer: Buffer): Promise<ParsedReport> {
  const parsed = await pdfParse(buffer);
  const lines = parsed.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { format: "pdf", columns: [], rows: [] };
  }

  // Treat the first non-empty line as the header row; split on 2+ spaces
  // (falling back to single spaces) to guess columns.
  const splitCells = (line: string): string[] => {
    const byWide = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    return byWide.length > 1 ? byWide : line.split(/\s+/).filter(Boolean);
  };

  const header = splitCells(lines[0]);
  const columns =
    header.length > 1
      ? header
      : header.map((_, i) => `col${i + 1}`);

  const rows: ParsedRow[] = lines.slice(1).map((line) => {
    const cells = splitCells(line);
    const data: Record<string, any> = {};
    columns.forEach((col, i) => {
      data[col] = cells[i] ?? "";
    });
    // Preserve the raw line too, so nothing is silently lost.
    data.__rawLine = line;
    return { data, needsReview: true };
  });

  return { format: "pdf", columns: [...columns, "__rawLine"], rows };
}

/** Parse an uploaded parts report buffer into normalized rows. */
export async function parsePartsReport(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ParsedReport> {
  const format = detectSourceFormat(fileName, mimeType);
  if (format === "pdf") {
    return parsePdf(buffer);
  }
  return parseSpreadsheet(buffer, format);
}
