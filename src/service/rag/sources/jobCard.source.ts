import { JobCardModel, IJobCardDocument } from "../../../models/ServiceM/JobCard";
import { ROLES, extractBranchId } from "../../../types/user.types";
import { registerSource } from "../sourceRegistry";

// internalNotes is deliberately excluded from the embedded text below — it's
// marked "never returned in customer-facing responses" on the model, and RAG
// answers could surface embedded text to any role in allowedRoles (including
// Branch-Admin), so it's kept out of the index entirely rather than building
// a second, more-restrictive chunk variant.
//
// Named "jobcard-live" (not "service-jobcard") to avoid colliding with the
// dedicated ServiceJobcard module's imported historical revenue rows — a
// different dataset, registered separately as
// sources/jobcardRevenueImport.source.ts.
registerSource({
  sourceType: "jobcard-live",
  model: JobCardModel,
  displayName: "Job Card (Live)",
  selectFields:
    "jobCardNumber branch status priority serviceType lineItems grandTotal customerRequests createdAt",

  toChunk(doc: IJobCardDocument) {
    const items = (doc.lineItems || [])
      .filter((item) => !item.isRemoved)
      .map((item) => `${item.name} x${item.quantity} @ ${item.unitPrice}`)
      .join("; ");
    return {
      text:
        `Job card ${doc.jobCardNumber}, status ${doc.status}, service type ${doc.serviceType}, priority ${doc.priority}. ` +
        `Line items: ${items || "none"}. Grand total: ${doc.grandTotal}. ` +
        `Customer requests: ${doc.customerRequests || "none"}.`,
      metadata: {
        jobCardNumber: doc.jobCardNumber,
        status: doc.status,
        serviceType: doc.serviceType,
        grandTotal: doc.grandTotal,
      },
    };
  },

  listForIndex(filter) {
    const query: Record<string, any> = {};
    if (filter.branchId) query.branch = filter.branchId;
    if (filter.since) query.createdAt = { $gte: filter.since };
    return query;
  },

  scope: {
    branchField: "branch",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN, ROLES.BRANCH_ADMIN],
    extractBranchId: (doc: IJobCardDocument) => extractBranchId(doc.branch),
  },
});
