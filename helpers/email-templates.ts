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
