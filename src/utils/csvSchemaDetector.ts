// utils/csvSchemaDetector.ts

export interface DetectedSchema {
  columns: string[];
  mappings: Record<string, string>;
  sampleData: Record<string, any>[];
}

const CORE_FIELD_MAPPINGS: Record<string, string[]> = {
  modelVariant: ["Model Variant", "Model", "Variant", "Model Name"],
  engineNumber: ["Engine Number", "Engine No", "Engine"],
  frameNumber: ["Frame Number", "Chassis Number", "Chassis", "Frame"],
  color: ["Color", "Colour"],
  location: ["LOCATION", "Location", "Branch"],
  costPrice: ["COST PRICE", "Cost Price", "COAST PRICE", "Coast Price"],
};

export function detectCSVSchema(
  records: Record<string, any>[]
): DetectedSchema {
  if (records.length === 0) {
    throw new Error("No records to analyze");
  }

  const columns = Object.keys(records[0]);
  const mappings: Record<string, string> = {};

  // Auto-map known fields
  for (const [targetField, possibleNames] of Object.entries(
    CORE_FIELD_MAPPINGS
  )) {
    const match = columns.find((col) =>
      possibleNames.some((name) => col.toLowerCase() === name.toLowerCase())
    );

    if (match) {
      mappings[targetField] = match;
    }
  }

  // Validate required mappings
  const required = ["modelVariant", "engineNumber", "frameNumber", "color"];
  const missing = required.filter((field) => !mappings[field]);

  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  return {
    columns,
    mappings,
    sampleData: records.slice(0, 3),
  };
}
