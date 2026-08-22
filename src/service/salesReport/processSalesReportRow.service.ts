import mongoose from "mongoose";
import { BaseCustomerModel } from "../../models/CustomerSystem/BaseCustomer";
import { CustomerVehicleModel } from "../../models/BikeSystemModel2/CustomerVehicleModel";
import { StockConceptCSVModel } from "../../models/BikeSystemModel3/StockConceptCSV";
import { StockConceptModel } from "../../models/BikeSystemModel2/StockConcept";
import { normalizePhone } from "../salesReport.service";
import logger from "../../utils/logger";

export type SalesReportRowOutcome =
  | "matched_status_flipped"
  | "matched_manual_form_status_flipped"
  | "matched_already_sold"
  | "unmatched"
  | "customer_conflict";

export interface ProcessSalesReportRowInput {
  modelName: string;
  modelVariant: string;
  customerFirstName: string;
  customerLastName: string;
  customerMobile: string;
  frameNo: string;
  engineNo: string;
  purchaseType: string;
  totalPayment: number;
}

export interface ProcessSalesReportRowResult {
  outcome: SalesReportRowOutcome;
  matched: boolean;
  needsReview: boolean;
  matchedStockId?: mongoose.Types.ObjectId;
  matchedStockType?: "StockConceptCSV" | "StockConcept";
  customerId?: mongoose.Types.ObjectId;
  customerVehicleId?: mongoose.Types.ObjectId;
}

/**
 * Processes one SalesReport row: matches it against StockConceptCSV by Frame
 * No OR Engine No, flips matched-but-unsold stock to "Sold", and creates/
 * links the customer + CustomerVehicle. Mirrors
 * ServiceJobcard/autoRegisterCustomer.service.ts#autoRegisterFromServiceJobcard,
 * adapted for the "already-sold vehicle CSV" use case:
 *
 *  - Match is OR'd across frameNo/engineNo (not frame-number-only), and
 *    scoped to the uploading branch.
 *  - No legacy StockConcept fallback and NO placeholder-stock creation on a
 *    miss — an unmatched row is just recorded for visibility (needsReview),
 *    never fabricates a stock record.
 *  - A stock row already "Sold" is left untouched (matched_already_sold)
 *    rather than re-processed, so re-uploads don't double-count.
 *  - New BaseCustomer docs get creationSource: "new_csv_sales_report"; an
 *    existing customer's creationSource is never overwritten.
 */
export async function processSalesReportRow(
  row: ProcessSalesReportRowInput,
  branchId: string,
  uploadedBy: mongoose.Types.ObjectId,
): Promise<ProcessSalesReportRowResult> {
  const frameNo = row.frameNo?.trim().toUpperCase();
  const engineNo = row.engineNo?.trim().toUpperCase();

  const orMatch: Record<string, any>[] = [];
  if (frameNo) orMatch.push({ frameNumber: frameNo });
  if (engineNo) orMatch.push({ engineNumber: engineNo });

  const stockDoc = orMatch.length
    ? await StockConceptCSVModel.findOne({
        "stockStatus.branchId": branchId,
        $or: orMatch,
      })
    : null;

  if (!stockDoc) {
    // No Daily Stock (CSV) match — fall back to the Manual stock form
    // (StockConceptModel). Unlike the CSV match above, a Manual-form match
    // only ever flips the status field: no customer/vehicle gets linked
    // here, so it's always flagged needsReview for manual follow-up.
    const manualDoc = orMatch.length
      ? await StockConceptModel.findOne({
          "stockStatus.branchId": branchId,
          $or: [
            ...(engineNo ? [{ engineNumber: engineNo }] : []),
            ...(frameNo ? [{ chassisNumber: frameNo }] : []),
          ],
        })
      : null;

    if (!manualDoc) {
      return { outcome: "unmatched", matched: false, needsReview: true };
    }

    if (manualDoc.stockStatus.status === "Sold") {
      return {
        outcome: "matched_already_sold",
        matched: true,
        needsReview: true,
        matchedStockId: manualDoc._id as unknown as mongoose.Types.ObjectId,
        matchedStockType: "StockConcept",
      };
    }

    manualDoc.stockStatus.status = "Sold";
    await manualDoc.save();

    return {
      outcome: "matched_manual_form_status_flipped",
      matched: true,
      needsReview: true,
      matchedStockId: manualDoc._id as unknown as mongoose.Types.ObjectId,
      matchedStockType: "StockConcept",
    };
  }

  if (stockDoc.stockStatus.status === "Sold") {
    return {
      outcome: "matched_already_sold",
      matched: true,
      needsReview: true,
      matchedStockId: stockDoc._id as unknown as mongoose.Types.ObjectId,
      matchedStockType: "StockConceptCSV",
    };
  }

  const phoneNumber = normalizePhone(row.customerMobile);
  if (!phoneNumber) {
    logger.warn(
      `SalesReport: no valid phone number for frame ${frameNo || engineNo}, leaving stock unflipped`,
    );
    return {
      outcome: "unmatched",
      matched: true,
      needsReview: true,
      matchedStockId: stockDoc._id as unknown as mongoose.Types.ObjectId,
      matchedStockType: "StockConceptCSV",
    };
  }

  let customer = await BaseCustomerModel.findOne({ phoneNumber });
  if (!customer) {
    customer = await BaseCustomerModel.create({
      phoneNumber,
      isVerified: false,
      creationSource: "new_csv_sales_report",
    });
  }

  // CustomerVehicle.customer is unique — don't violate that constraint if
  // this customer already owns a different vehicle.
  const existingForCustomer = await CustomerVehicleModel.findOne({
    customer: customer._id,
  });
  if (existingForCustomer) {
    logger.warn(
      `SalesReport: customer ${customer._id} already owns a vehicle, skipping link for frame ${frameNo}`,
    );
    return {
      outcome: "customer_conflict",
      matched: true,
      needsReview: true,
      matchedStockId: stockDoc._id as unknown as mongoose.Types.ObjectId,
      matchedStockType: "StockConceptCSV",
      customerId: customer._id as unknown as mongoose.Types.ObjectId,
    };
  }

  const vehicle = await CustomerVehicleModel.create({
    stockConcept: stockDoc._id,
    stockType: "StockConceptCSV",
    customer: customer._id,
    isPaid: true,
    isFinance: false,
    insurance: false,
  });

  stockDoc.stockStatus.status = "Sold";
  stockDoc.salesInfo = {
    soldTo: customer._id as unknown as mongoose.Types.ObjectId,
    soldDate: new Date(),
    salePrice: row.totalPayment,
    paymentStatus: "Paid",
    customerVehicleId: vehicle._id as unknown as mongoose.Types.ObjectId,
  };
  await stockDoc.save();

  return {
    outcome: "matched_status_flipped",
    matched: true,
    needsReview: false,
    matchedStockId: stockDoc._id as unknown as mongoose.Types.ObjectId,
    matchedStockType: "StockConceptCSV",
    customerId: customer._id as unknown as mongoose.Types.ObjectId,
    customerVehicleId: vehicle._id as unknown as mongoose.Types.ObjectId,
  };
}
