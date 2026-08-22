import { StockConceptModel, IStockConcept } from "../../../models/BikeSystemModel2/StockConcept";
import { ROLES, extractBranchId } from "../../../types/user.types";
import { registerSource } from "../sourceRegistry";

// Only assigned (sold) stock is meaningful for this source — unsold
// inventory has no salesInfo to narrate or cite, so listForIndex always
// requires salesInfo.soldDate to exist.
registerSource({
  sourceType: "stock-assign",
  model: StockConceptModel,
  displayName: "Stock Assignment",
  selectFields:
    "stockId modelName category stockStatus salesInfo createdAt",

  toChunk(doc: IStockConcept) {
    const sale = doc.salesInfo;
    return {
      text:
        `Stock ${doc.stockId} (${doc.modelName}, ${doc.category}) assigned to a customer on ` +
        `${sale?.soldDate ? new Date(sale.soldDate).toDateString() : "an unknown date"}. ` +
        `Sale price: ${sale?.salePrice ?? "unknown"}. Payment status: ${sale?.paymentStatus ?? "unknown"}. ` +
        `Invoice: ${sale?.invoiceNumber ?? "none"}.`,
      metadata: {
        stockId: doc.stockId,
        modelName: doc.modelName,
        salePrice: sale?.salePrice,
        paymentStatus: sale?.paymentStatus,
      },
    };
  },

  listForIndex(filter) {
    const query: Record<string, any> = { "salesInfo.soldDate": { $exists: true } };
    if (filter.branchId) query["stockStatus.branchId"] = filter.branchId;
    if (filter.since) query["salesInfo.soldDate"] = { $gte: filter.since };
    return query;
  },

  scope: {
    branchField: "stockStatus.branchId",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN],
    extractBranchId: (doc: IStockConcept) =>
      extractBranchId(doc.stockStatus?.branchId),
  },
});
