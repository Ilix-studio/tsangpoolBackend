/**
 * Notification event catalogue. Each value identifies the kind of event that
 * produced a push/history notification so the frontend can filter, icon, and
 * route on it. Keep these string values in sync with the frontend mirror in
 * `client/src/redux-store/services/notificationApi.ts`.
 */
export const NOTIFICATION_TYPES = {
  SERVICE_BOOKING: "service-booking",
  CONTACT_MESSAGE: "contact-message",
  GET_APPROVED: "get-approved",
  ENQUIRY: "enquiry",
  PARTS_UPLOAD: "parts-upload",
  COUNTER_SALE_UPLOAD: "counter-sale-upload",
  SERVICE_JOBCARD_UPLOAD: "service-jobcard-upload",
  SALES_REPORT_UPLOAD: "sales-report-upload",
  JOB_CARD_INVOICE: "job-card-invoice",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
