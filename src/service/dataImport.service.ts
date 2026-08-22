import crypto from "crypto";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";

/**
 * Generalized parsing service for the DataImport module. This mirrors
 * `partsReport.service.ts` (kept untouched so the Parts module stays
 * isolated) but adds: UTF-16 BOM detection + delimiter auto-detection for
 * CSV/TSV, and multi-sheet workbook support (sheet names exposed, optional
 * sheet selection).
 */
export type SourceFormat = "xlsx" | "csv" | "pdf";

export interface ParsedRow {
  /** All columns of the row, keyed by (trimmed) header. */
  data: Record<string, any>;
  /** True for low-confidence rows (currently: everything parsed from PDF, or rows with unparseable numeric/date fields). */
  needsReview: boolean;
}

export interface ParsedReport {
  format: SourceFormat;
  columns: string[];
  rows: ParsedRow[];
  /** All sheet names found in the workbook (xlsx/xls only). */
  sheetNames?: string[];
  /** Which sheet was actually parsed (xlsx/xls only). */
  sheetUsed?: string;
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
 * so trivial whitespace/case differences don't defeat dedup. Identical
 * algorithm to `partsReport.service.ts#computeRowHash` so dedup behavior is
 * predictable across both modules.
 */
export function computeRowHash(data: Record<string, any>): string {
  const normalized = Object.keys(data)
    .sort()
    .map(
      (k) =>
        `${k.trim().toLowerCase()}=${String(data[k] ?? "").trim().toLowerCase()}`,
    )
    .join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Decode a raw file buffer to text, detecting a UTF-16 LE/BE BOM (real
 * parts-stock exports are UTF-16, tab-delimited). Falls back to UTF-8.
 */
export function decodeBuffer(buffer: Buffer): {
  text: string;
  usedEncoding: "utf16le" | "utf16be" | "utf8";
} {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      text: buffer.slice(2).toString("utf16le"),
      usedEncoding: "utf16le",
    };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // Node has no native UTF-16BE decoder — byte-swap then decode as LE.
    const swapped = Buffer.from(buffer.slice(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const tmp = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = tmp;
    }
    return { text: swapped.toString("utf16le"), usedEncoding: "utf16be" };
  }
  let text = buffer.toString("utf8");
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, usedEncoding: "utf8" };
}

/** Pick the delimiter that occurs most often in a sample (header) line. */
export function detectDelimiter(sampleLine: string): "\t" | "," | ";" {
  const counts: Record<"\t" | "," | ";", number> = {
    "\t": (sampleLine.match(/\t/g) || []).length,
    ",": (sampleLine.match(/,/g) || []).length,
    ";": (sampleLine.match(/;/g) || []).length,
  };
  let best: "\t" | "," | ";" = "\t";
  let bestCount = -1;
  (["\t", ",", ";"] as const).forEach((d) => {
    if (counts[d] > bestCount) {
      best = d;
      bestCount = counts[d];
    }
  });
  return best;
}

/** Normalize a header cell for fuzzy header-row detection (mirrors serviceJobcardColumnMatcher#normalizeHeader). */
function normalizeHeaderCell(h: any): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How many leading rows to scan when locating the true header row. */
const HEADER_SCAN_LIMIT = 20;

/**
 * Locate the header row within a sheet's first rows. Dealer/MIS exports often
 * carry a report title, a date-range line, and/or blank rows *above* the real
 * column headers, so the header is not always row 0 — keying `sheet_to_json`
 * off row 0 in that case yields junk column names and every canonical-column
 * match fails. When `expectedHeaders` is supplied, pick the scanned row with
 * the most cells matching a known header; otherwise fall back to the first row
 * with more than one non-empty cell.
 */
export function detectHeaderRowIndex(
  matrix: any[][],
  expectedHeaders?: string[],
): number {
  if (matrix.length === 0) return -1;

  if (expectedHeaders && expectedHeaders.length > 0) {
    const expectedSet = new Set(expectedHeaders.map(normalizeHeaderCell));
    let bestIdx = -1;
    let bestScore = 0;
    const scanEnd = Math.min(matrix.length, HEADER_SCAN_LIMIT);
    for (let i = 0; i < scanEnd; i++) {
      const row = matrix[i] || [];
      let score = 0;
      for (const cell of row) {
        const norm = normalizeHeaderCell(cell);
        if (norm && expectedSet.has(norm)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    // Require at least two known headers on the row before trusting it, so a
    // stray data cell that happens to equal a header label can't win.
    if (bestScore >= 2) return bestIdx;
  }

  for (let i = 0; i < matrix.length; i++) {
    const nonEmpty = (matrix[i] || []).filter(
      (c) => String(c ?? "").trim() !== "",
    ).length;
    if (nonEmpty > 1) return i;
  }
  return 0;
}

/** Build unique, non-empty column keys from a header row (SheetJS-style disambiguation). */
function buildColumnKeys(headerRow: any[]): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((cell, j) => {
    let name = String(cell ?? "").trim();
    if (name === "") name = `__EMPTY_${j}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count}`;
  });
}

/**
 * Turn a raw cell matrix (array-of-arrays) into columns + row objects, keyed
 * off the *detected* header row rather than assuming row 0.
 */
function recordsFromMatrix(
  matrix: any[][],
  expectedHeaders?: string[],
): { columns: string[]; rows: ParsedRow[] } {
  const headerIdx = detectHeaderRowIndex(matrix, expectedHeaders);
  if (headerIdx < 0) return { columns: [], rows: [] };

  const columns = buildColumnKeys(matrix[headerIdx] || []);
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    if (!cells.some((c) => String(c ?? "").trim() !== "")) continue;
    const data: Record<string, any> = {};
    columns.forEach((col, j) => {
      data[col] = cells[j] ?? "";
    });
    rows.push({ data, needsReview: false });
  }
  return { columns, rows };
}

/**
 * Delimited-text parser, delegating the actual tokenizing to SheetJS
 * (`XLSX.read` with a DSV field-separator override) instead of a hand-rolled
 * splitter. SheetJS's DSV parser is quote-aware (a quoted field may contain
 * the delimiter or even an embedded newline, with `""` as an escaped literal
 * quote) — real dealer exports (e.g. the parts-stock MIS export) wrap every
 * field in quotes regardless of whether it needs it, and a naive
 * `line.split(delimiter)` would leave those quote characters embedded in every
 * value, silently breaking numeric parsing (Quantity/Unit Price) downstream in
 * columnMatcher.ts#buildNormalizedRow. The header row is auto-detected (see
 * recordsFromMatrix) rather than assumed to be the first line.
 */
export function parseDelimitedText(
  text: string,
  delimiter: string,
  expectedHeaders?: string[],
): { columns: string[]; rows: ParsedRow[] } {
  if (text.trim().length === 0) return { columns: [], rows: [] };

  const workbook = XLSX.read(text, { type: "string", FS: delimiter, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { columns: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  return recordsFromMatrix(matrix, expectedHeaders);
}

/** Parse an XLSX/XLS buffer into row objects via SheetJS. */
export function parseSpreadsheet(
  buffer: Buffer,
  format: SourceFormat,
  sheetName?: string,
  expectedHeaders?: string[],
): ParsedReport {
  // SheetJS auto-detects .xls (BIFF) vs .xlsx (OOXML) from the buffer's
  // magic bytes, so no separate BIFF handling is needed.
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = workbook.SheetNames;
  const targetSheet =
    sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];

  if (!targetSheet) {
    return { format, columns: [], rows: [], sheetNames, sheetUsed: undefined };
  }

  const sheet = workbook.Sheets[targetSheet];
  // header: 1 returns raw cell rows so the true header can be detected below;
  // defval: "" keeps empty cells so column positions stay stable across rows.
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const { columns, rows } = recordsFromMatrix(matrix, expectedHeaders);
  return { format, columns, rows, sheetNames, sheetUsed: targetSheet };
}

/**
 * Best-effort PDF extraction: pull text, then split whitespace-delimited
 * lines into cells. This is inherently unreliable, so every row is flagged
 * `needsReview` for manual confirmation on the frontend. Identical heuristic
 * to `partsReport.service.ts#parsePdf`.
 */
export async function parsePdfTable(buffer: Buffer): Promise<ParsedReport> {
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
  const columns = header.length > 1 ? header : header.map((_, i) => `col${i + 1}`);

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

/** Delimiters attempted (beyond the header-line guess) when parsing a CSV/TSV buffer. */
const DELIMITER_CANDIDATES: readonly string[] = ["\t", ",", ";", "|"];

/**
 * Parse a delimited-text (CSV/TSV/semicolon/pipe) buffer with BOM handling and
 * a robust delimiter fallback. `detectDelimiter` gives a first guess from the
 * header line, but real exports occasionally use a delimiter that isn't the
 * most frequent character there — a wrong guess collapses every field into a
 * single column and fails column matching. So we try each candidate and keep
 * whichever yields the most columns. As a last resort (a "CSV" that is really
 * space-aligned fixed-width text, with no real delimiter), runs of 2+ spaces
 * are treated as the separator.
 */
function parseCsvBuffer(buffer: Buffer, expectedHeaders?: string[]): ParsedReport {
  const { text } = decodeBuffer(buffer);
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim().length > 0) || "";

  const guessed = detectDelimiter(firstLine);
  const ordered = [guessed, ...DELIMITER_CANDIDATES.filter((d) => d !== guessed)];

  let best: { columns: string[]; rows: ParsedRow[] } | null = null;
  for (const d of ordered) {
    const parsed = parseDelimitedText(text, d, expectedHeaders);
    if (!best || parsed.columns.length > best.columns.length) best = parsed;
  }

  if (!best || best.columns.length <= 1) {
    const wsText = text
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/ {2,}/g, "\t"))
      .join("\n");
    const ws = parseDelimitedText(wsText, "\t", expectedHeaders);
    if (!best || ws.columns.length > best.columns.length) best = ws;
  }

  return { format: "csv", columns: best?.columns ?? [], rows: best?.rows ?? [] };
}

/**
 * Parse an uploaded dealer-export buffer into normalized rows, routed by
 * detected format. `opts.expectedHeaders` (the caller's known column
 * labels/aliases) drives header-row detection and delimiter fallback for
 * exports that carry title/blank rows above the header or use an unusual
 * delimiter.
 */
export async function parseDataImportFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
  opts?: { sheetName?: string; expectedHeaders?: string[] },
): Promise<ParsedReport> {
  const format = detectSourceFormat(fileName, mimeType);
  if (format === "pdf") {
    return parsePdfTable(buffer);
  }
  if (format === "csv") {
    return parseCsvBuffer(buffer, opts?.expectedHeaders);
  }
  return parseSpreadsheet(buffer, format, opts?.sheetName, opts?.expectedHeaders);
}
