import nodemailer from "nodemailer";
import logger from "./logger";

// ─── Transporter ─────────────────────────────────────────────────────────────

const createTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured. Emails will be skipped.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface WelcomeEmailPayload {
  to: string;
  name: string;
  phoneNumber: string;
  password: string;
  role: string;
  /** Omitted for project-wide roles (Developer) that belong to no branch. */
  branchName?: string;
  position?: string; // only for Staff
}

// ─── Send Welcome Email ──────────────────────────────────────────────────────

export const sendWelcomeEmail = async (
  payload: WelcomeEmailPayload,
): Promise<boolean> => {
  const transporter = createTransporter();

  if (!transporter) {
    logger.warn(
      `SMTP not configured. Skipping welcome email for ${payload.to}`,
    );
    return false;
  }

  const fromName = process.env.SMTP_FROM_NAME || "Honda Dealership";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  const positionLine = payload.position
    ? `<tr><td style="padding:8px 12px;font-weight:600;color:#555;">Position</td><td style="padding:8px 12px;">${payload.position}</td></tr>`
    : "";

  // Branch-less roles get no Branch row and no "at <branch>" clause, rather
  // than an empty one.
  const branchLine = payload.branchName
    ? `<tr><td style="padding:8px 12px;font-weight:600;color:#555;">Branch</td><td style="padding:8px 12px;">${payload.branchName}</td></tr>`
    : "";
  const branchClause = payload.branchName
    ? ` at <strong>${payload.branchName}</strong>`
    : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f7;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#cc0000;padding:32px 24px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:24px;">Welcome Aboard!</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 24px;">
            <p style="font-size:16px;color:#333;margin:0 0 16px;">Hi <strong>${payload.name}</strong>,</p>
            <p style="font-size:15px;color:#555;margin:0 0 24px;">
              You have been registered as <strong>${payload.role}</strong>${branchClause}.
              Below are your login credentials. Please change your password after your first login.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;border:1px solid #e5e5e5;margin-bottom:24px;">
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Application ID</td><td style="padding:8px 12px;font-family:monospace;font-size:15px;">${payload.phoneNumber}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Password</td><td style="padding:8px 12px;font-family:monospace;font-size:15px;">${payload.password}</td></tr>
              ${branchLine}
              ${positionLine}
            </table>

            <p style="font-size:13px;color:#999;margin:0;">
              This is an auto-generated email. Do not share your credentials with anyone.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f4f4f7;padding:16px 24px;text-align:center;">
            <p style="font-size:12px;color:#aaa;margin:0;">&copy; ${new Date().getFullYear()} ${fromName}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: payload.to,
      subject: `Welcome to ${fromName} — Your Login Credentials`,
      html,
    });
    logger.info(`Welcome email sent to ${payload.to}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send welcome email to ${payload.to}:`, error);
    return false;
  }
};
// Add this interface and function to your existing emailService.ts

interface LeaveNotificationPayload {
  superAdminEmail: string;
  applicantName: string;
  applicantRole: string;
  branchName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  applicationId: string; // leave doc _id as string
}

export const sendLeaveNotificationEmail = async (
  payload: LeaveNotificationPayload,
): Promise<boolean> => {
  const transporter = createTransporter();
  if (!transporter) {
    logger.warn("SMTP not configured. Skipping leave notification email.");
    return false;
  }

  const fromName = process.env.SMTP_FROM_NAME || "Honda Dealership";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f7;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#cc0000;padding:28px 24px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">New Leave Application</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px;">
            <p style="font-size:15px;color:#333;margin:0 0 20px;">
              A new leave application has been submitted and requires your review.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;border:1px solid #e5e5e5;margin-bottom:24px;">
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Applicant</td><td style="padding:8px 12px;">${payload.applicantName}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Role</td><td style="padding:8px 12px;">${payload.applicantRole}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Branch</td><td style="padding:8px 12px;">${payload.branchName}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Leave Type</td><td style="padding:8px 12px;">${payload.leaveType}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">From</td><td style="padding:8px 12px;">${payload.startDate}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">To</td><td style="padding:8px 12px;">${payload.endDate}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Total Days</td><td style="padding:8px 12px;">${payload.totalDays}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600;color:#555;">Reason</td><td style="padding:8px 12px;">${payload.reason}</td></tr>
            </table>
            <p style="font-size:13px;color:#999;margin:0;">Reference ID: ${payload.applicationId}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f4f4f7;padding:16px 24px;text-align:center;">
            <p style="font-size:12px;color:#aaa;margin:0;">&copy; ${new Date().getFullYear()} ${fromName}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: payload.superAdminEmail,
      subject: `Leave Application — ${payload.applicantName} (${payload.leaveType}, ${payload.totalDays}d)`,
      html,
    });
    logger.info(
      `Leave notification sent to super admin: ${payload.superAdminEmail}`,
    );
    return true;
  } catch (error) {
    logger.error("Failed to send leave notification email:", error);
    return false;
  }
};
// o$LY3Az*B+
// BM-5BB2-DF65
