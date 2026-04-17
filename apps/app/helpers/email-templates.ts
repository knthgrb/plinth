export function generateInvitationEmail(
  organizationName: string,
  inviterName: string,
  role: string,
  invitationLink: string,
): { subject: string; html: string; text: string } {
  const subject = `Invitation to join ${organizationName} on Plinth`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #9333ea 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">Plinth</h1>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #1f2937; margin-top: 0;">You've been invited!</h2>
        <p>Hello,</p>
        <p><strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> on Plinth as a <strong>${role}</strong>.</p>
        <p>Click the button below to accept the invitation and get started:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${invitationLink}" style="display: inline-block; background: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Invitation</a>
        </div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #9333ea; font-size: 12px; word-break: break-all;">${invitationLink}</p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">This invitation will expire in 7 days.</p>
      </div>
      <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Plinth. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  const text = `
You've been invited!

${inviterName} has invited you to join ${organizationName} on Plinth as a/an ${role}.

Accept the invitation by visiting this link:
${invitationLink}

This invitation will expire in 7 days.

© ${new Date().getFullYear()} Plinth. All rights reserved.
  `;

  return { subject, html, text };
}

export function generatePasswordResetEmail(resetLink: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Reset your password - Plinth`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #9333ea 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">Plinth</h1>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #1f2937; margin-top: 0;">Reset your password</h2>
        <p>Hello,</p>
        <p>We received a request to reset your password for your Plinth account.</p>
        <p>Click the button below to reset your password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="display: inline-block; background: #9333ea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #9333ea; font-size: 12px; word-break: break-all;">${resetLink}</p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.</p>
      </div>
      <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Plinth. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  const text = `
Reset your password

We received a request to reset your password for your Plinth account.

Reset your password by visiting this link:
${resetLink}

This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.

© ${new Date().getFullYear()} Plinth. All rights reserved.
  `;

  return { subject, html, text };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateLeaveRequestApprovedEmail(params: {
  employeeFirstName: string;
  organizationName: string;
  leaveTypeLabel: string;
  periodLabel: string;
  numberOfDays: number;
  reason: string;
  reviewerRemarks?: string;
  approvedByName?: string;
  reviewerPosition?: string;
  leavePageUrl: string;
}): { subject: string; html: string; text: string } {
  const {
    employeeFirstName,
    organizationName,
    leaveTypeLabel,
    periodLabel,
    numberOfDays,
    reason,
    reviewerRemarks,
    approvedByName,
    reviewerPosition,
    leavePageUrl,
  } = params;

  const reasonSafe = escapeHtml(reason);
  const remarksSafe = reviewerRemarks?.trim()
    ? escapeHtml(reviewerRemarks.trim())
    : "";
  const approverSafe = approvedByName?.trim()
    ? escapeHtml(approvedByName.trim())
    : "";
  const positionSafe = reviewerPosition?.trim()
    ? escapeHtml(reviewerPosition.trim())
    : "";

  const subject = `Your leave request was approved — ${organizationName}`;

  const remarksBlock = remarksSafe
    ? `<p><strong>Notes from reviewer:</strong> ${remarksSafe}</p>`
    : "";
  const approverBlock = approverSafe
    ? `<p><strong>Reviewed by:</strong> ${approverSafe}${
        positionSafe
          ? `<br/><span style="font-size:13px;color:#4b5563;">${positionSafe}</span>`
          : ""
      }</p>`
    : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #9333ea 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">Plinth</h1>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #1f2937; margin-top: 0;">Leave request approved</h2>
        <p>Hello ${escapeHtml(employeeFirstName)},</p>
        <p>Your leave request at <strong>${escapeHtml(organizationName)}</strong> has been <strong style="color: #059669;">approved</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;">
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Leave type</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${escapeHtml(leaveTypeLabel)}</td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Period</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${escapeHtml(periodLabel)}</td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Days</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${numberOfDays}</td></tr>
          <tr><td style="padding: 8px 0; vertical-align: top;"><strong>Your reason</strong></td><td style="padding: 8px 0;">${reasonSafe}</td></tr>
        </table>
        ${approverBlock}
        ${remarksBlock}
        <div style="text-align: center; margin: 28px 0 0;">
          <a href="${leavePageUrl}" style="display: inline-block; background: #9333ea; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">View leave</a>
        </div>
      </div>
      <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Plinth. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  const text = `
Leave request approved

Hello ${employeeFirstName},

Your leave request at ${organizationName} has been approved.

Leave type: ${leaveTypeLabel}
Period: ${periodLabel}
Days: ${numberOfDays}
Your reason: ${reason}
${approvedByName?.trim() ? `Reviewed by: ${approvedByName.trim()}${reviewerPosition?.trim() ? ` (${reviewerPosition.trim()})` : ""}\n` : ""}${reviewerRemarks?.trim() ? `Notes from reviewer: ${reviewerRemarks.trim()}\n` : ""}
View leave: ${leavePageUrl}

© ${new Date().getFullYear()} Plinth. All rights reserved.
  `.trim();

  return { subject, html, text };
}

export function generateLeaveRequestRejectedEmail(params: {
  employeeFirstName: string;
  organizationName: string;
  leaveTypeLabel: string;
  periodLabel: string;
  numberOfDays: number;
  reason: string;
  rejectionReason: string;
  leavePageUrl: string;
}): { subject: string; html: string; text: string } {
  const {
    employeeFirstName,
    organizationName,
    leaveTypeLabel,
    periodLabel,
    numberOfDays,
    reason,
    rejectionReason,
    leavePageUrl,
  } = params;

  const reasonSafe = escapeHtml(reason);
  const rejectionSafe = escapeHtml(rejectionReason.trim());

  const subject = `Your leave request was declined — ${organizationName}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #9333ea 0%, #7c3aed 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">Plinth</h1>
      </div>
      <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #1f2937; margin-top: 0;">Leave request declined</h2>
        <p>Hello ${escapeHtml(employeeFirstName)},</p>
        <p>Your leave request at <strong>${escapeHtml(organizationName)}</strong> was <strong style="color: #dc2626;">not approved</strong>.</p>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 0 0 8px; font-weight: bold; color: #991b1b;">Reason for decision</p>
          <p style="margin: 0; color: #451a1a;">${rejectionSafe}</p>
        </div>
        <p style="font-size: 14px; color: #4b5563;">For reference, here are the details of the request you submitted:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Leave type</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${escapeHtml(leaveTypeLabel)}</td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Period</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${escapeHtml(periodLabel)}</td></tr>
          <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Days</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${numberOfDays}</td></tr>
          <tr><td style="padding: 8px 0; vertical-align: top;"><strong>Your reason</strong></td><td style="padding: 8px 0;">${reasonSafe}</td></tr>
        </table>
        <div style="text-align: center; margin: 28px 0 0;">
          <a href="${leavePageUrl}" style="display: inline-block; background: #9333ea; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">View leave</a>
        </div>
      </div>
      <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Plinth. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  const text = `
Leave request declined

Hello ${employeeFirstName},

Your leave request at ${organizationName} was not approved.

Reason for decision:
${rejectionReason.trim()}

Your submitted request:
Leave type: ${leaveTypeLabel}
Period: ${periodLabel}
Days: ${numberOfDays}
Your reason: ${reason}

View leave: ${leavePageUrl}

© ${new Date().getFullYear()} Plinth. All rights reserved.
  `.trim();

  return { subject, html, text };
}
