import { CustomerVehicleModel, ICustomerVehicle } from "../../../models/BikeSystemModel2/CustomerVehicleModel";
import { ROLES, extractBranchId } from "../../../types/user.types";
import { registerSource } from "../sourceRegistry";

// CustomerVehicle has no branch field of its own — branch lives on the
// StockConcept it references — so `stockConcept` must be populated before
// extractBranchId() can resolve it. listForIndex deliberately does not
// filter by branchId (that would require an aggregation, not a plain
// find() filter); branch scoping still happens correctly at embed time via
// extractBranchId below, which is what the semantic query path actually
// filters on.
registerSource({
  sourceType: "vas-assign",
  model: CustomerVehicleModel,
  displayName: "VAS Assignment",
  selectFields: "stockConcept customer activeValueAddedServices createdAt",
  populate: "stockConcept",

  toChunk(doc: ICustomerVehicle) {
    const active = (doc.activeValueAddedServices || []).filter((s) => s.isActive);
    const summary = active
      .map(
        (s) =>
          `service ${s.serviceId} activated ${new Date(s.activatedDate).toDateString()}, ` +
          `expires ${new Date(s.expiryDate).toDateString()}, price ${s.purchasePrice}`,
      )
      .join("; ");
    return {
      text: `Customer vehicle with ${active.length} active VAS service(s): ${summary || "none"}.`,
      metadata: {
        activeCount: active.length,
      },
    };
  },

  listForIndex(filter) {
    const query: Record<string, any> = {
      "activeValueAddedServices.0": { $exists: true },
    };
    if (filter.since) query["activeValueAddedServices.activatedDate"] = { $gte: filter.since };
    return query;
  },

  scope: {
    branchField: "stockConcept.stockStatus.branchId",
    allowedRoles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN],
    extractBranchId: (doc: ICustomerVehicle) =>
      extractBranchId((doc.stockConcept as any)?.stockStatus?.branchId),
  },
});
