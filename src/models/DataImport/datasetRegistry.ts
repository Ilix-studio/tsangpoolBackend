import { ROLES, UserRole } from "../../types/user.types";
import { SourceFormat } from "../../service/dataImport.service";

/**
 * The 3 dealer-export dataset types this module can ingest. (parts-stock and
 * service-jobcard used to be entries here too, but each moved to its own
 * dedicated module — see models/PartsReport.ts + controllers/Parts/, and
 * models/ServiceJobcard/ + controllers/ServiceJobcard/.) Adding a new
 * dataset type means: a new entry in DATASET_REGISTRY below, plus wiring it
 * into any dataset-specific dashboard aggregation on the frontend.
 */
export type DatasetType = "vehicle-stock" | "service-timetrack" | "invoice";

export const DATASET_TYPES: DatasetType[] = [
  "vehicle-stock",
  "service-timetrack",
  "invoice",
];

export interface CanonicalField {
  key: string;
  label: string;
  required: boolean;
  /** Exact header strings/variants seen in real source files. */
  aliases: string[];
}

export interface DatasetDefinition {
  datasetType: DatasetType;
  label: string;
  fields: CanonicalField[];
  allowedRoles: UserRole[];
  sourceFormats: SourceFormat[];
  /** Canonical field keys usable to join this dataset against others. */
  joinKeys: string[];
}

export const DATASET_REGISTRY: Record<DatasetType, DatasetDefinition> = {
  "vehicle-stock": {
    datasetType: "vehicle-stock",
    label: "Vehicle Stock",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN],
    sourceFormats: ["xlsx"],
    joinKeys: ["frameNumber"],
    fields: [
      { key: "slNo", label: "SL NO", required: false, aliases: ["SL NO", "SL. NO", "Sl No"] },
      { key: "modelVariant", label: "Model Variant", required: true, aliases: ["Model Variant"] },
      { key: "color", label: "Color", required: false, aliases: ["Color", "Colour"] },
      { key: "frameNumber", label: "Frame Number", required: true, aliases: ["Frame Number"] },
      { key: "engineNumber", label: "Engine Number", required: false, aliases: ["Engine Number"] },
      { key: "location", label: "Location", required: false, aliases: ["LOCATION", "Location"] },
      {
        key: "costPrice",
        label: "Cost Price",
        required: false,
        aliases: ["COST PRICE", "Cost Price", "COAST PRICE", "Coast Price"],
      },
      { key: "mrnDays", label: "MRN Days", required: false, aliases: ["MRN DAYS", "MRN Days"] },
    ],
  },
  "service-timetrack": {
    datasetType: "service-timetrack",
    label: "Service Time Track",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN, ROLES.STAFF],
    sourceFormats: ["xlsx"],
    joinKeys: ["jobCardNumber", "frameNumber"],
    fields: [
      {
        key: "jobCardNumber",
        label: "JobCard Number",
        required: true,
        aliases: ["JobCard Number", "Job Card Number"],
      },
      { key: "frameNumber", label: "Frame Number", required: true, aliases: ["Frame Number"] },
    ],
  },
  invoice: {
    datasetType: "invoice",
    label: "Tax Invoice",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN],
    sourceFormats: ["pdf"],
    joinKeys: ["partNumber"],
    fields: [
      {
        key: "partNumber",
        label: "Part No/Jobcode",
        required: true,
        aliases: ["Part No/Jobcode", "Part No", "Jobcode"],
      },
      { key: "description", label: "Description", required: false, aliases: ["Description"] },
      { key: "hsnSacCode", label: "HSN/SAC Code", required: false, aliases: ["HSN/SAC Code"] },
      { key: "qty", label: "Qty", required: false, aliases: ["Qty"] },
      { key: "unitPrice", label: "Unit Price", required: false, aliases: ["Unit Price"] },
      { key: "totalAmount", label: "Total Amount", required: true, aliases: ["Total Amount"] },
      { key: "billingType", label: "Billing Type", required: false, aliases: ["Billing Type"] },
    ],
  },
};

export function getDatasetDefinition(type: DatasetType): DatasetDefinition {
  return DATASET_REGISTRY[type];
}

export function isDatasetType(value: string): value is DatasetType {
  return (DATASET_TYPES as string[]).includes(value);
}

export function getAllowedDatasetsForRole(role: UserRole): DatasetDefinition[] {
  return DATASET_TYPES.map((t) => DATASET_REGISTRY[t]).filter((d) =>
    d.allowedRoles.includes(role),
  );
}
