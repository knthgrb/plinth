export function buildPayslipEmailContent(firstName: string, period: string) {
  const subject = `Your payslip — ${period}`;
  const html = `
  <p>Hello ${firstName},</p>
  <p>Your payslip for <strong>${period}</strong> is attached as a password-protected PDF.</p>
  `;
  const text = `Hello ${firstName},\n\nYour payslip for ${period} is attached as a password-protected PDF.\n`;
  return { subject, html, text };
}
