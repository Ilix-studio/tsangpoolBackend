import mongoose from "mongoose";
import { ROLES } from "../types/user.types";
import { NOTIFICATION_TYPES } from "../types/notification.types";
import { NotifyEvent } from "./pushNotification.service";

/**
 * notificationTargeting — event catalogue. Each builder maps a domain event to
 * its recipient audiences + push payload so trigger sites stay one-liners:
 *
 *   notify(NotificationEvents.contactMessage({ name }))
 *
 * Recipient rules follow the plan matrix. `route` in `data` is a best-effort
 * deep-link the client uses when a notification is opened.
 */

type Branch = string | mongoose.Types.ObjectId | null | undefined;

export const NotificationEvents = {
  serviceBooking: (opts: {
    branch: Branch;
    bookingId?: string;
    serviceType?: string;
  }): NotifyEvent => ({
    audiences: [
      { roles: [ROLES.BRANCH_ADMIN, ROLES.SERVICE_ADMIN], branch: opts.branch },
    ],
    type: NOTIFICATION_TYPES.SERVICE_BOOKING,
    title: "New service booking",
    body: opts.serviceType
      ? `A new "${opts.serviceType}" service was booked.`
      : "A new service was booked.",
    data: {
      route: "/service/bookings",
      ...(opts.bookingId ? { bookingId: opts.bookingId } : {}),
    },
  }),

  contactMessage: (opts: { name?: string; subject?: string }): NotifyEvent => ({
    audiences: [{ roles: [ROLES.SUPER_ADMIN] }],
    type: NOTIFICATION_TYPES.CONTACT_MESSAGE,
    title: "New contact message",
    body: opts.name
      ? `${opts.name} sent a message${opts.subject ? `: ${opts.subject}` : ""}.`
      : "A new contact message was received.",
    data: { route: "/admin/messages" },
  }),

  getApproved: (opts: {
    branch?: Branch;
    applicantName?: string;
  }): NotifyEvent => ({
    audiences: [
      { roles: [ROLES.SUPER_ADMIN] },
      ...(opts.branch
        ? [{ roles: [ROLES.BRANCH_ADMIN], branch: opts.branch }]
        : []),
    ],
    type: NOTIFICATION_TYPES.GET_APPROVED,
    title: "New finance pre-approval",
    body: opts.applicantName
      ? `${opts.applicantName} submitted a finance application.`
      : "A new finance pre-approval application was submitted.",
    data: { route: "/admin/getapproved" },
  }),

  enquiry: (opts: { name?: string }): NotifyEvent => ({
    audiences: [{ roles: [ROLES.SUPER_ADMIN] }],
    type: NOTIFICATION_TYPES.ENQUIRY,
    title: "New enquiry",
    body: opts.name
      ? `${opts.name} submitted an enquiry.`
      : "A new enquiry was submitted.",
    data: { route: "/admin/enquiries" },
  }),

  partsUpload: (opts: {
    fileName?: string;
    rowCount?: number;
  }): NotifyEvent => ({
    audiences: [{ roles: [ROLES.SUPER_ADMIN] }],
    type: NOTIFICATION_TYPES.PARTS_UPLOAD,
    title: "New parts report uploaded",
    body: opts.fileName
      ? `"${opts.fileName}"${opts.rowCount ? ` (${opts.rowCount} rows)` : ""} was uploaded.`
      : "A new parts report was uploaded.",
    data: { route: "/admin/parts" },
  }),

  counterSaleUpload: (opts: {
    branch?: Branch;
    fileName?: string;
    rowCount?: number;
  }): NotifyEvent => ({
    audiences: [
      { roles: [ROLES.SUPER_ADMIN] },
      ...(opts.branch
        ? [{ roles: [ROLES.BRANCH_ADMIN], branch: opts.branch }]
        : []),
    ],
    type: NOTIFICATION_TYPES.COUNTER_SALE_UPLOAD,
    title: "New counter sale report",
    body: opts.fileName
      ? `"${opts.fileName}"${opts.rowCount ? ` (${opts.rowCount} rows)` : ""} was uploaded.`
      : "A new counter sale report was uploaded.",
    data: { route: "/admin/counter-sale" },
  }),

  serviceJobcardUpload: (opts: {
    branch?: Branch;
    fileName?: string;
    rowCount?: number;
  }): NotifyEvent => ({
    audiences: [
      { roles: [ROLES.SUPER_ADMIN] },
      ...(opts.branch
        ? [{ roles: [ROLES.SERVICE_ADMIN], branch: opts.branch }]
        : []),
    ],
    type: NOTIFICATION_TYPES.SERVICE_JOBCARD_UPLOAD,
    title: "New service jobcard report",
    body: opts.fileName
      ? `"${opts.fileName}"${opts.rowCount ? ` (${opts.rowCount} rows)` : ""} was uploaded.`
      : "A new service jobcard report was uploaded.",
    data: { route: "/service/jobcard-reports" },
  }),

  salesReportUpload: (opts: {
    branch?: Branch;
    fileName?: string;
    rowCount?: number;
  }): NotifyEvent => ({
    audiences: [
      { roles: [ROLES.SUPER_ADMIN] },
      ...(opts.branch
        ? [{ roles: [ROLES.BRANCH_ADMIN], branch: opts.branch }]
        : []),
    ],
    type: NOTIFICATION_TYPES.SALES_REPORT_UPLOAD,
    title: "New sales report uploaded",
    body: opts.fileName
      ? `"${opts.fileName}"${opts.rowCount ? ` (${opts.rowCount} rows)` : ""} was uploaded.`
      : "A new sales report was uploaded.",
    data: { route: "/admin/sales-report" },
  }),

  jobCardInvoice: (opts: {
    branch?: Branch;
    invoiceId?: string;
    grandTotal?: number;
  }): NotifyEvent => ({
    audiences: [
      { roles: [ROLES.SUPER_ADMIN] },
      ...(opts.branch
        ? [{ roles: [ROLES.SERVICE_ADMIN], branch: opts.branch }]
        : [{ roles: [ROLES.SERVICE_ADMIN] }]),
    ],
    type: NOTIFICATION_TYPES.JOB_CARD_INVOICE,
    title: "New invoice generated",
    body: opts.grandTotal
      ? `An invoice for ₹${opts.grandTotal} was generated.`
      : "A new invoice was generated.",
    data: {
      route: "/service/invoices",
      ...(opts.invoiceId ? { invoiceId: opts.invoiceId } : {}),
    },
  }),
};
