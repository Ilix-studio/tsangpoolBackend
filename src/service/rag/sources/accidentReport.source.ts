import AccidentReportModel, {
  IAccidentReport,
} from "../../../models/AdminFeatures/AccidentReport";
import { ROLES, extractBranchId } from "../../../types/user.types";
import { registerSource } from "../sourceRegistry";

// adminNotes is deliberately excluded from the embedded text below, for the
// same reason as JobCard.internalNotes: it's an internal-only workflow field
// and RAG answers could surface embedded text to any role in allowedRoles.
registerSource({
  sourceType: "accident-report",
  model: AccidentReportModel,
  displayName: "Accident Report",
  selectFields:
    "reportId branch title date time location isInsuranceAvailable status createdAt",

  toChunk(doc: IAccidentReport) {
    return {
      text:
        `Accident report ${doc.reportId}: "${doc.title}" on ${doc.date?.toISOString?.().slice(0, 10)} ` +
        `at ${doc.time}, location: ${doc.location}. ` +
        `Insurance available: ${doc.isInsuranceAvailable ? "yes" : "no"}. Status: ${doc.status}.`,
      metadata: {
        reportId: doc.reportId,
        status: doc.status,
        date: doc.date,
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
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN],
    extractBranchId: (doc: IAccidentReport) => extractBranchId(doc.branch),
  },
});
