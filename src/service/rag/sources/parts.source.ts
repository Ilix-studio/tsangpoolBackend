import { PartsReportModel, IPartsReport } from "../../../models/PartsReport";
import { ROLES, extractBranchId } from "../../../types/user.types";
import { registerSource } from "../sourceRegistry";

registerSource({
  sourceType: "parts",
  model: PartsReportModel,
  displayName: "Parts Report Row",
  selectFields:
    "partId rowData detectedColumns sourceFormat importBatch importDate fileName branchId needsReview createdAt",

  toChunk(doc: IPartsReport) {
    const cols = doc.detectedColumns?.length
      ? doc.detectedColumns
          .map((c) => `${c}: ${doc.rowData?.[c] ?? ""}`)
          .join(", ")
      : JSON.stringify(doc.rowData);
    return {
      text:
        `Parts report row (batch ${doc.importBatch}, imported ${doc.importDate?.toISOString?.().slice(0, 10)}, ` +
        `source ${doc.sourceFormat}): ${cols}${doc.needsReview ? " [FLAGGED FOR REVIEW]" : ""}`,
      metadata: {
        partId: doc.partId,
        importBatch: doc.importBatch,
        fileName: doc.fileName,
        needsReview: doc.needsReview,
      },
    };
  },

  listForIndex(filter) {
    // isCurrent: superseded rows (a part's older value, replaced by a later
    // upload) shouldn't be indexed as if they were still accurate.
    const query: Record<string, any> = { isActive: true, isCurrent: { $ne: false } };
    if (filter.branchId) query.branchId = filter.branchId;
    if (filter.since) query.createdAt = { $gte: filter.since };
    return query;
  },

  scope: {
    branchField: "branchId",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.PART_ADMIN],
    extractBranchId: (doc: IPartsReport) => extractBranchId(doc.branchId),
  },
});
