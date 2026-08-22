import { parseDataImportFile } from "./dataImport.service";
import {
  matchSalesReportColumns,
  buildSalesReportNormalizedRow,
  getSalesReportHeaderAliases,
  SalesReportColumnMatchResult,
} from "../utils/salesReportColumnMatcher";

export type SourceFormat = "xlsx" | "csv";

export interface ParsedRow {
  /** All columns of the row, keyed by (trimmed) header. */
  data: Record<string, any>;
}

export interface ParsedReport {
  format: SourceFormat;
  columns: string[];
  rows: ParsedRow[];
}

export interface CuratedSalesReportFields {
  modelName: string;
  modelVariant: string;
  customerFirstName: string;
  customerLastName: string;
  customerMobile: string;
  frameNo: string;
  engineNo: string;
  status: string;
  purchaseType: string;
  totalPayment: number;
  needsReview: boolean;
}

/**
 * True only for the real binary spreadsheet magic bytes: ZIP (xlsx, "PK")
 * or OLE2/CFB (legacy xls, "D0 CF 11 E0"). Some dealer-export tools (a
 * Windows/.NET "Export to Excel" button, in practice) write plain delimited
 * text — often UTF-16-with-BOM — but still name the file .xlsx/.xls. Routing
 * those through the binary spreadsheet reader instead of the UTF-16-aware
 * CSV decoder (dataImport.service.ts#decodeBuffer) silently mangles every
 * cell into BOM + null-interleaved garbage, so every column match fails at
 * once. Sniffing the actual bytes instead of trusting the extension is what
 * fixes that class of upload.
 */
function looksLikeBinarySpreadsheet(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return true; // ZIP -> xlsx
  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  )
    return true; // OLE2/CFB -> legacy xls
  return false;
}

const NUL_CHAR = String.fromCharCode(0);

/**
 * Reverses a specific, deterministic corruption seen in some real dealer
 * export tools: the workbook's shared-strings XML is supposed to be UTF-8
 * text but was actually written as raw UTF-16LE bytes (with BOM), and the
 * xlsx reader decodes those bytes one-for-one as Latin-1 rather than
 * transcoding them. Every cell comes out as the intended text with a NUL
 * character wedged in next to each real character — but NOT at a consistent
 * before/after position: because cell boundaries in the underlying byte
 * stream don't stay aligned to 2-byte UTF-16 pairs (an odd-length string
 * shifts the parity for every cell after it), some cells read as
 * char,NUL,char,NUL,... and others as NUL,char,NUL,char,.... Reversing this
 * doesn't require re-pairing the bytes at all — since a NUL character never
 * legitimately appears in real business text (names, model numbers, phone
 * numbers), simply stripping every NUL recovers the intended text regardless
 * of which side of each pair it landed on. The 2-byte BOM (misread as two
 * garbage characters) only ever appears once, glued to the very first cell.
 */
function repairMisdecodedUtf16(value: string): string {
  if (typeof value !== "string" || value.length === 0) return value;

  const hasLeadingBom =
    value.charCodeAt(0) === 0xff && value.charCodeAt(1) === 0xfe;
  const hasEmbeddedNul = value.indexOf(NUL_CHAR) !== -1;
  if (!hasLeadingBom && !hasEmbeddedNul) return value;

  const withoutBom = hasLeadingBom ? value.slice(2) : value;
  const repaired = withoutBom.split(NUL_CHAR).join("").trim();
  return repaired || value;
}

/**
 * Parse an uploaded sales report buffer (list of sold vehicles) into rows.
 * Delegates to the shared dataImport.service.ts parser instead of a naive
 * "row 0 is the header" read — real dealer/OEM booking exports (like this
 * one) often carry a report title, a filter summary, or blank rows above
 * the real header row, and may use a delimiter other than comma. Passing
 * every known SalesReport header/alias as `expectedHeaders` lets the parser
 * locate the true header row and pick the right delimiter (see
 * dataImport.service.ts#detectHeaderRowIndex / #parseCsvBuffer) — the same
 * approach the ServiceJobcard import already relies on for this class of
 * export. Only CSV/XLS/XLSX ever reach here (multer rejects everything
 * else), so PDF's row-level needsReview flag never applies.
 *
 * The effective filename passed down is content-sniffed rather than trusted
 * verbatim — see looksLikeBinarySpreadsheet — so a mislabeled UTF-16 text
 * file gets routed through the CSV/TSV decoder (with its BOM + delimiter
 * detection) regardless of its .xlsx/.xls extension. Every resulting column
 * name and cell value also passes through repairMisdecodedUtf16, since a
 * *genuine* xlsx can independently have a broken shared-strings table that
 * mangles values the same way even once routing is correct.
 */
export async function parseSalesReport(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ParsedReport> {
  const isRealBinarySpreadsheet = looksLikeBinarySpreadsheet(buffer);
  const effectiveFileName = isRealBinarySpreadsheet
    ? fileName
    : fileName.replace(/\.(xlsx|xls)$/i, "") + ".csv";
  const effectiveMimeType = isRealBinarySpreadsheet ? mimeType : "text/csv";

  const parsed = await parseDataImportFile(buffer, effectiveFileName, effectiveMimeType, {
    expectedHeaders: getSalesReportHeaderAliases(),
  });

  const repairedColumns = parsed.columns.map(repairMisdecodedUtf16);
  const repairedRows: ParsedRow[] = parsed.rows.map((r) => {
    const data: Record<string, any> = {};
    parsed.columns.forEach((originalCol, i) => {
      const value = r.data[originalCol];
      data[repairedColumns[i]] =
        typeof value === "string" ? repairMisdecodedUtf16(value) : value;
    });
    return { data };
  });

  return {
    format: parsed.format as SourceFormat,
    columns: repairedColumns,
    rows: repairedRows,
  };
}

const PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * Normalize a customer mobile number to a bare 10-digit string, same
 * validation as autoRegisterCustomer.service.ts#normalizePhone — duplicated
 * locally rather than imported, since that function isn't exported for reuse
 * and this module owns its own row shape.
 */
export function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "").slice(-10);
  return PHONE_REGEX.test(digits) ? digits : null;
}

/**
 * Extract the curated SalesReport fields from a raw parsed row, gated by the
 * mandatory-field-checked matchResult. Throws (per-row reject, not
 * whole-batch) if Frame No is blank — it's this report's dedup key, same
 * rationale as CounterSaleReport's CPOTC-order-number guard.
 */
export function extractCuratedFields(
  data: Record<string, any>,
  matchResult: SalesReportColumnMatchResult,
): CuratedSalesReportFields {
  const { normalized, needsReview: parseNeedsReview } =
    buildSalesReportNormalizedRow(data, matchResult);

  const frameNo = (normalized.frameNo ?? "").trim();
  if (!frameNo) {
    throw new Error('Missing "Frame No" — required for de-duplication');
  }

  return {
    modelName: normalized.modelName ?? "",
    modelVariant: normalized.modelVariant ?? "",
    customerFirstName: normalized.customerFirstName ?? "",
    customerLastName: normalized.customerLastName ?? "",
    customerMobile: normalized.customerMobile ?? "",
    frameNo,
    engineNo: normalized.engineNo ?? "",
    status: "Sold",
    purchaseType: normalized.purchaseType ?? "",
    totalPayment: normalized.totalPayment ?? 0,
    needsReview: parseNeedsReview,
  };
}

export { matchSalesReportColumns };
