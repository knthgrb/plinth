import { payslipPdfPasswordDescription } from "@/lib/payslip-pdf-password";

export function buildPayslipEmailContent(firstName: string, period: string) {
  const passHint = payslipPdfPasswordDescription();
  const subject = `Your payslip — ${period}`;
  const html = `
  <p>Hello ${firstName},</p>
  <p>Your payslip for <strong>${period}</strong> is attached as a password-protected PDF.</p>
  <p><strong>How to open the PDF:</strong> ${passHint}</p>
  <p>Your Plinth login password is never stored in readable form, so it cannot be used as the PDF password. Use the date of birth or company ID described above—the same values on your HR profile.</p>
  `;
  const text = `Hello ${firstName},\n\nYour payslip for ${period} is attached as a password-protected PDF.\n\nOpen password: ${passHint}\n\nPlinth cannot embed your login password in PDFs because it is stored with one-way encryption.\n`;
  return { subject, html, text };
}
