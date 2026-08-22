import {
  CanonicalField,
  DatasetDefinition,
  DatasetType,
} from "../../models/DataImport/datasetRegistry";

export interface MatchedField {
  canonicalKey: string;
  label: string;
  sourceColumn: string;
}

export interface ColumnMatchResult {
  matchedFields: MatchedField[];
  unmatchedColumns: string[];
  missingRequired: string[];
  isValid: boolean;
}

/** Normalize a header for comparison: trim, collapse whitespace, lowercase, strip punctuation. */
export function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[.:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a file's detected columns onto a dataset's canonical fields. */
export function matchColumns(
  detectedColumns: string[],
  dataset: DatasetDefinition,
): ColumnMatchResult {
  const lookup = new Map<string, CanonicalField>();
  dataset.fields.forEach((field) => {
    lookup.set(normalizeHeader(field.label), field);
    field.aliases.forEach((alias) => lookup.set(normalizeHeader(alias), field));
  });

  const matchedFields: MatchedField[] = [];
  const unmatchedColumns: string[] = [];
  const matchedKeys = new Set<string>();

  detectedColumns.forEach((column) => {
    const field = lookup.get(normalizeHeader(column));
    if (field) {
      matchedFields.push({
        canonicalKey: field.key,
        label: field.label,
        sourceColumn: column,
      });
      matchedKeys.add(field.key);
    } else {
      unmatchedColumns.push(column);
    }
  });

  const missingRequired = dataset.fields
    .filter((f) => f.required && !matchedKeys.has(f.key))
    .map((f) => f.key);

  return {
    matchedFields,
    unmatchedColumns,
    missingRequired,
    isValid: missingRequired.length === 0,
  };
}

/**
 * Flat superset of every canonical field across all dataset types. Only the
 * keys relevant to a given row's datasetType are populated; the rest stay
 * undefined. Stored as Mixed on ImportedRow (see models/DataImport/ImportedRow.ts).
 */
export interface NormalizedRow {
  // join keys
  frameNumber?: string;
  jobCardNumber?: string;
  partNumber?: string;
  engineNumber?: string;

  // vehicle-stock
  slNo?: string;
  modelVariant?: string;
  color?: string;
  location?: string;
  costPrice?: number;
  mrnDays?: number;
  sourceSheet?: string;

  // parts-stock
  description?: string;
  hsnCode?: string;
  quantity?: number;
  unitPrice?: number;
  stockValue?: number;
  inventoryLocationName?: string;
  partCategory?: string;
  availability?: string;
  dealerCode?: string;
  status?: string;
  locationOrder?: number;
  locator1?: string;
  locator2?: string;
  locator3?: string;
  hmsiMake?: string;
  divisionZone?: string;
  divisionRegion?: string;

  // invoice
  hsnSacCode?: string;
  qty?: number;
  totalAmount?: number;
  billingType?: string;
}

const JOIN_KEY_STRING_FIELDS = new Set([
  "frameNumber",
  "jobCardNumber",
  "partNumber",
  "engineNumber",
]);

const NUMERIC_FIELDS = new Set([
  "quantity",
  "unitPrice",
  "stockValue",
  "costPrice",
  "mrnDays",
  "qty",
  "totalAmount",
  "locationOrder",
]);

const DATE_FIELDS = new Set<string>([]);

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
  // export format. Must be tried BEFORE the generic `new Date(str)` fallback:
  // V8 happily (mis)parses ambiguous "05-07-2026" as US-style MM-DD-YYYY in
  // local time, silently swapping day/month for any day <= 12.
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

/** Build the canonical `normalized` object for one parsed row. */
export function buildNormalizedRow(
  rowData: Record<string, any>,
  matchResult: ColumnMatchResult,
  _datasetType: DatasetType,
): { normalized: NormalizedRow; needsReview: boolean } {
  const normalized: NormalizedRow = {};
  let needsReview = false;

  matchResult.matchedFields.forEach(({ canonicalKey, sourceColumn }) => {
    const raw = rowData[sourceColumn];

    if (JOIN_KEY_STRING_FIELDS.has(canonicalKey)) {
      const value = String(raw ?? "").trim().toUpperCase();
      if (value) (normalized as any)[canonicalKey] = value;
      return;
    }

    if (NUMERIC_FIELDS.has(canonicalKey)) {
      const value = parseNumeric(raw);
      if (value === undefined) {
        if (String(raw ?? "").trim() !== "") needsReview = true;
      } else {
        (normalized as any)[canonicalKey] = value;
      }
      return;
    }

    if (DATE_FIELDS.has(canonicalKey)) {
      const value = parseFlexibleDate(raw);
      if (value === undefined) {
        if (String(raw ?? "").trim() !== "") needsReview = true;
      } else {
        (normalized as any)[canonicalKey] = value;
      }
      return;
    }

    const value = String(raw ?? "").trim();
    if (value) (normalized as any)[canonicalKey] = value;
  });

  return { normalized, needsReview };
}
