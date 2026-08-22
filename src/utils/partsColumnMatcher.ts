/**
 * Minimal, Parts-only column matcher for parts-stock uploads. Deliberately
 * NOT a reuse of utils/dataImport/columnMatcher.ts or datasetRegistry.ts —
 * the Parts module owns its own business column-mapping, independent of the
 * generic multi-dataset-type DataImport module (see partsStockDiff.service.ts
 * for the diffing logic this feeds).
 */

export interface PartsStockNormalizedRow {
  partNumber?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  inventoryLocationName?: string;
}

interface PartsField {
  key: keyof PartsStockNormalizedRow;
  label: string;
  required: boolean;
  aliases: string[];
}

const PARTS_STOCK_FIELDS: PartsField[] = [
  { key: "partNumber", label: "Part Number", required: true, aliases: ["Part Number"] },
  { key: "description", label: "Description", required: true, aliases: ["Description"] },
  { key: "quantity", label: "Quantity", required: true, aliases: ["Quantity"] },
  { key: "unitPrice", label: "Unit Price", required: false, aliases: ["Unit Price"] },
  {
    key: "inventoryLocationName",
    label: "Location",
    required: false,
    aliases: ["Location", "Inventory Location Name"],
  },
];

export interface PartsMatchedField {
  canonicalKey: string;
  label: string;
  sourceColumn: string;
}

export interface PartsColumnMatchResult {
  matchedFields: PartsMatchedField[];
  unmatchedColumns: string[];
  missingRequired: string[];
  isValid: boolean;
}

/** Normalize a header for comparison: trim, collapse whitespace, lowercase, strip punctuation. */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[.:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a file's detected columns onto the parts-stock canonical fields. */
export function matchPartsColumns(detectedColumns: string[]): PartsColumnMatchResult {
  const lookup = new Map<string, PartsField>();
  PARTS_STOCK_FIELDS.forEach((field) => {
    lookup.set(normalizeHeader(field.label), field);
    field.aliases.forEach((alias) => lookup.set(normalizeHeader(alias), field));
  });

  const matchedFields: PartsMatchedField[] = [];
  const unmatchedColumns: string[] = [];
  const matchedKeys = new Set<string>();

  detectedColumns.forEach((column) => {
    const field = lookup.get(normalizeHeader(column));
    if (field) {
      matchedFields.push({ canonicalKey: field.key, label: field.label, sourceColumn: column });
      matchedKeys.add(field.key);
    } else {
      unmatchedColumns.push(column);
    }
  });

  const missingRequired = PARTS_STOCK_FIELDS.filter(
    (f) => f.required && !matchedKeys.has(f.key),
  ).map((f) => f.key);

  return {
    matchedFields,
    unmatchedColumns,
    missingRequired,
    isValid: missingRequired.length === 0,
  };
}

const NUMERIC_KEYS = new Set(["quantity", "unitPrice"]);

function parseNumeric(raw: any): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const cleaned = String(raw).replace(/[,₹$\s]/g, "").trim();
  if (cleaned === "") return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the canonical `normalized` object for one parsed parts-stock row. */
export function buildPartsNormalizedRow(
  rowData: Record<string, any>,
  matchResult: PartsColumnMatchResult,
): { normalized: PartsStockNormalizedRow; needsReview: boolean } {
  const normalized: PartsStockNormalizedRow = {};
  let needsReview = false;

  matchResult.matchedFields.forEach(({ canonicalKey, sourceColumn }) => {
    const raw = rowData[sourceColumn];

    if (canonicalKey === "partNumber") {
      const value = String(raw ?? "").trim().toUpperCase();
      if (value) normalized.partNumber = value;
      return;
    }

    if (NUMERIC_KEYS.has(canonicalKey)) {
      const value = parseNumeric(raw);
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
