/**
 * Dedicated, Service-Jobcard-only column matcher/normalizer. Deliberately NOT
 * a reuse of utils/dataImport/columnMatcher.ts or datasetRegistry.ts — the
 * ServiceJobcard module owns its own business column-mapping, independent of
 * the generic multi-dataset-type DataImport module (mirrors
 * utils/partsColumnMatcher.ts's isolation rationale).
 */

export interface ServiceJobcardNormalizedRow {
  jobCardNumber?: string;
  frameNumber?: string;
  customerName?: string;
  customerMobile?: string;
  modelName?: string;
  modelVariant?: string;
  serviceType?: string;
  amcService?: string;
  currentKms?: number;
  jobCardClosedDate?: Date;
  jobCardCreatedDate?: Date;
  labourRevenue?: number;
  partsRevenue?: number;
  lubesRevenue?: number;
  accessoriesRevenue?: number;
  totalJobCardRevenue?: number;
  technicianName?: string;
  registrationNumber?: string;
}

interface JobcardField {
  key: keyof ServiceJobcardNormalizedRow;
  label: string;
  required: boolean;
  aliases: string[];
}

const SERVICE_JOBCARD_FIELDS: JobcardField[] = [
  { key: "jobCardNumber", label: "Job Card Number", required: true, aliases: ["Job Card Number", "JobCard Number"] },
  { key: "frameNumber", label: "Frame Number", required: true, aliases: ["Frame Number"] },
  { key: "customerName", label: "Customer Name", required: false, aliases: ["Customer Name"] },
  { key: "customerMobile", label: "Customer Mobile", required: false, aliases: ["Customer Mobile"] },
  { key: "modelName", label: "Model Name", required: false, aliases: ["Model Name"] },
  { key: "modelVariant", label: "Model Variant", required: false, aliases: ["Model Variant"] },
  { key: "serviceType", label: "Service Type", required: false, aliases: ["Service Type"] },
  { key: "amcService", label: "AMC Service", required: false, aliases: ["AMC Service"] },
  { key: "currentKms", label: "Current KMs", required: false, aliases: ["Current KMs"] },
  { key: "jobCardClosedDate", label: "Job Card Closed Date", required: true, aliases: ["Job Card Closed Date"] },
  { key: "jobCardCreatedDate", label: "Job Card Created Date", required: false, aliases: ["Job Card Created Date"] },
  { key: "labourRevenue", label: "Labour Revenue", required: false, aliases: ["Labour Revenue"] },
  { key: "partsRevenue", label: "Parts Revenue", required: false, aliases: ["Parts Revenue"] },
  { key: "lubesRevenue", label: "Lubes Revenue", required: false, aliases: ["Lubes Revenue"] },
  { key: "accessoriesRevenue", label: "Accessories Revenue", required: false, aliases: ["Accessories Revenue"] },
  { key: "totalJobCardRevenue", label: "Total Job Card Revenue", required: true, aliases: ["Total Job Card Revenue"] },
  { key: "technicianName", label: "Technician Name", required: false, aliases: ["Technician Name"] },
  { key: "registrationNumber", label: "Registration Number", required: false, aliases: ["Registration Number"] },
];

export interface JobcardMatchedField {
  canonicalKey: string;
  label: string;
  sourceColumn: string;
}

export interface JobcardColumnMatchResult {
  matchedFields: JobcardMatchedField[];
  unmatchedColumns: string[];
  missingRequired: string[];
  isValid: boolean;
}

/**
 * Every known header string (canonical labels + aliases) for the service-jobcard
 * dataset. Passed to the file parser so it can locate the real header row when a
 * dealer export carries title/blank rows above it, and choose the right
 * delimiter for ambiguous CSVs. See dataImport.service.ts#detectHeaderRowIndex.
 */
export function getServiceJobcardHeaderAliases(): string[] {
  const all: string[] = [];
  SERVICE_JOBCARD_FIELDS.forEach((f) => {
    all.push(f.label, ...f.aliases);
  });
  return all;
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

/** Map a file's detected columns onto the service-jobcard canonical fields. */
export function matchServiceJobcardColumns(
  detectedColumns: string[],
): JobcardColumnMatchResult {
  const lookup = new Map<string, JobcardField>();
  SERVICE_JOBCARD_FIELDS.forEach((field) => {
    lookup.set(normalizeHeader(field.label), field);
    field.aliases.forEach((alias) => lookup.set(normalizeHeader(alias), field));
  });

  const matchedFields: JobcardMatchedField[] = [];
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

  const missingRequired = SERVICE_JOBCARD_FIELDS.filter(
    (f) => f.required && !matchedKeys.has(f.key),
  ).map((f) => f.key);

  return {
    matchedFields,
    unmatchedColumns,
    missingRequired,
    isValid: missingRequired.length === 0,
  };
}

const JOIN_KEY_STRING_FIELDS = new Set(["jobCardNumber", "frameNumber"]);

const NUMERIC_KEYS = new Set([
  "currentKms",
  "labourRevenue",
  "partsRevenue",
  "lubesRevenue",
  "accessoriesRevenue",
  "totalJobCardRevenue",
]);

const DATE_KEYS = new Set(["jobCardClosedDate", "jobCardCreatedDate"]);

// \b (not \s+) after the title so "Mr.John" (no space) still strips, while
// names that merely start with the same letters — "Sirisha", "Mrinal",
// "Madamma" — don't: \b only matches where a word char is followed by a
// non-word char (or string end), so "Sir" immediately followed by the word
// char "i" in "Sirisha" never matches the boundary.
const HONORIFIC_PREFIX = /^(mr|mrs|ms|miss|sir|madam)\b\.?\s*/i;

/**
 * Strips leading honorifics/titles (Mr., Mrs., Ms., Sir, Madam — repeated,
 * e.g. "Mr. Mr. John") and stray ellipsis/dot runs from a job-card row's
 * free-text Customer Name column before it's stored or used for name-match
 * comparison (see autoRegisterCustomer.service.ts#resolveNameVerification).
 */
function cleanCustomerName(raw: string): string {
  let value = raw.replace(/\.{2,}/g, " ").trim();
  let prev: string;
  do {
    prev = value;
    value = value.replace(HONORIFIC_PREFIX, "").trim();
  } while (value !== prev);
  return value.replace(/\s+/g, " ").trim();
}

function parseNumeric(raw: any): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const cleaned = String(raw).replace(/[,₹$\s]/g, "").trim();
  if (cleaned === "") return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * DD-MM-YYYY / DD/MM/YYYY (and 2-digit year variants) aware date parser —
 * must be tried before the generic `new Date(str)` fallback, since V8 will
 * happily (mis)parse ambiguous "05-07-2026" as US-style MM-DD-YYYY in local
 * time, silently swapping day/month for any day <= 12. Same logic as
 * utils/dataImport/columnMatcher.ts#parseFlexibleDate, duplicated locally
 * per this module's isolation convention.
 */
function parseFlexibleDate(raw: any): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const str = String(raw).trim();

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

/** Build the canonical `normalized` object for one parsed service-jobcard row. */
export function buildServiceJobcardNormalizedRow(
  rowData: Record<string, any>,
  matchResult: JobcardColumnMatchResult,
): { normalized: ServiceJobcardNormalizedRow; needsReview: boolean } {
  const normalized: ServiceJobcardNormalizedRow = {};
  let needsReview = false;

  matchResult.matchedFields.forEach(({ canonicalKey, sourceColumn }) => {
    const raw = rowData[sourceColumn];

    if (JOIN_KEY_STRING_FIELDS.has(canonicalKey)) {
      const value = String(raw ?? "").trim().toUpperCase();
      if (value) (normalized as any)[canonicalKey] = value;
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

    if (DATE_KEYS.has(canonicalKey)) {
      const value = parseFlexibleDate(raw);
      if (value === undefined) {
        if (String(raw ?? "").trim() !== "") needsReview = true;
      } else {
        (normalized as any)[canonicalKey] = value;
      }
      return;
    }

    if (canonicalKey === "customerName") {
      const value = cleanCustomerName(String(raw ?? ""));
      if (value) normalized.customerName = value;
      return;
    }

    const value = String(raw ?? "").trim();
    if (value) (normalized as any)[canonicalKey] = value;
  });

  return { normalized, needsReview };
}
