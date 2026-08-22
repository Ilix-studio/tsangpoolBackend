import {
  ServiceJobcardRecordModel,
  IServiceJobcardRecord,
} from "../../../models/ServiceJobcard/ServiceJobcardRecord";
import { ROLES } from "../../../types/user.types";
import { extractBranchId } from "../../../types/user.types";
import { registerSource } from "../sourceRegistry";

// customerName/customerMobile are deliberately excluded from the embedded
// text below — they're PII on the normalized row, and RAG answers could
// surface embedded text to any role in allowedRoles. Only aggregate/vehicle
// identifiers and revenue figures are embedded.
registerSource({
  sourceType: "jobcard-revenue-import",
  model: ServiceJobcardRecordModel,
  displayName: "Imported Job Card Revenue Row",
  selectFields: "importBatch normalized branchId createdAt",

  toChunk(doc: IServiceJobcardRecord) {
    const n = doc.normalized || {};
    return {
      text:
        `Imported job card revenue row: job card ${n.jobCardNumber ?? "unknown"}, ` +
        `vehicle frame ${n.frameNumber ?? "unknown"}, model ${n.modelName ?? "unknown"}, ` +
        `service type ${n.serviceType ?? "unknown"}, closed ${n.jobCardClosedDate?.toString?.().slice(0, 10) ?? "unknown"}. ` +
        `Revenue — labour: ${n.labourRevenue ?? 0}, parts: ${n.partsRevenue ?? 0}, lubes: ${n.lubesRevenue ?? 0}, ` +
        `accessories: ${n.accessoriesRevenue ?? 0}, total: ${n.totalJobCardRevenue ?? 0}. ` +
        `Technician: ${n.technicianName ?? "unknown"}.`,
      metadata: {
        jobCardNumber: n.jobCardNumber,
        frameNumber: n.frameNumber,
        totalJobCardRevenue: n.totalJobCardRevenue,
      },
    };
  },

  listForIndex(filter) {
    // isCurrent: a corrected job card's superseded old value shouldn't be
    // indexed as if it were still accurate.
    const query: Record<string, any> = { isActive: true, isCurrent: { $ne: false } };
    if (filter.branchId) query.branchId = filter.branchId;
    if (filter.since) query.createdAt = { $gte: filter.since };
    return query;
  },

  scope: {
    branchField: "branchId",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN],
    extractBranchId: (doc: IServiceJobcardRecord) => extractBranchId(doc.branchId),
  },
});
