import "server-only";

import PDFDocument from "pdfkit";
import { getPayslipPdfOpenPassword } from "@/lib/payslip-pdf-password";

function num(x: unknown): number {
  if (typeof x === "number" && !Number.isNaN(x)) return x;
  if (typeof x === "string") {
    const n = parseFloat(x);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function formatPeso(n: number): string {
  return `₱${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function asDeductionArray(
  d: unknown,
): Array<{ name: string; amount: number; type: string }> {
  if (Array.isArray(d)) {
    return d.map((x: unknown) => {
      const row = x as Record<string, unknown>;
      return {
        name: String(row.name ?? ""),
        amount: num(row.amount),
        type: String(row.type ?? ""),
      };
    });
  }
  if (typeof d === "string") {
    try {
      const p = JSON.parse(d) as unknown;
      return Array.isArray(p)
        ? p.map((x: unknown) => {
            const row = x as Record<string, unknown>;
            return {
              name: String(row.name ?? ""),
              amount: num(row.amount),
              type: String(row.type ?? ""),
            };
          })
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asIncentiveArray(
  d: unknown,
): Array<{ name: string; amount: number; type?: string }> {
  if (Array.isArray(d)) {
    return d.map((x: unknown) => {
      const row = x as Record<string, unknown>;
      return {
        name: String(row.name ?? ""),
        amount: num(row.amount),
        type: row.type != null ? String(row.type) : undefined,
      };
    });
  }
  if (typeof d === "string") {
    try {
      const p = JSON.parse(d) as unknown;
      return Array.isArray(p)
        ? p.map((x: unknown) => {
            const row = x as Record<string, unknown>;
            return {
              name: String(row.name ?? ""),
              amount: num(row.amount),
            };
          })
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function renderPayslipPdfBuffer(args: {
  payslip: Record<string, unknown>;
  employee: {
    personalInfo: {
      firstName: string;
      lastName: string;
      email?: string;
      dateOfBirth?: number | null;
    };
    employment: {
      employeeId: string;
      position: string;
      department: string;
    };
  };
  organizationName: string;
  cutoffStart: number;
  cutoffEnd: number;
}): Promise<Buffer> {
  const userPassword = getPayslipPdfOpenPassword(args.employee);
  const ownerPassword =
    process.env.PAYSLIP_PDF_OWNER_PASSWORD ||
    `plinth-owner-${process.env.CONVEX_DEPLOYMENT ?? "dev"}`;

  const p = args.payslip;
  const period = String(p.period ?? "");
  const deductions = asDeductionArray(p.deductions);
  const incentives = asIncentiveArray(p.incentives);
  const gross = num(p.grossPay);
  const net = num(p.netPay);
  const daysWorked = num(p.daysWorked);
  const absences = num(p.absences);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      margin: 48,
      size: "LETTER",
      userPassword,
      ownerPassword,
      pdfVersion: "1.7ext3",
    });
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const start = new Date(args.cutoffStart).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const end = new Date(args.cutoffEnd).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    doc.fontSize(18).text(args.organizationName, { align: "center" });
    doc.moveDown(0.25);
    doc.fontSize(14).text("Payslip", { align: "center" });
    doc.moveDown(1);

    doc.fontSize(10);
    doc.text(
      `Employee: ${args.employee.personalInfo.firstName} ${args.employee.personalInfo.lastName}`,
    );
    doc.text(`Company ID: ${args.employee.employment.employeeId}`);
    doc.text(`Department: ${args.employee.employment.department}`);
    doc.text(`Position: ${args.employee.employment.position}`);
    doc.text(`Pay period: ${period}`);
    doc.text(`Cutoff: ${start} – ${end}`);
    doc.text(`Days worked: ${daysWorked}   Absences: ${absences}`);
    doc.moveDown(0.75);

    doc.fontSize(11).text("Earnings & adjustments", { underline: true });
    doc.moveDown(0.35);
    doc.fontSize(10);
    const basic = num(p.basicPay);
    if (basic > 0) doc.text(`Basic pay: ${formatPeso(basic)}`);
    const allowance = num(p.nonTaxableAllowance);
    if (allowance > 0) doc.text(`Non-taxable allowance: ${formatPeso(allowance)}`);
    const hp = num(p.holidayPay);
    if (hp > 0) doc.text(`Holiday pay: ${formatPeso(hp)}`);
    const rd = num(p.restDayPay);
    if (rd > 0) doc.text(`Rest day pay: ${formatPeso(rd)}`);
    const nd = num(p.nightDiffPay);
    if (nd > 0) doc.text(`Night differential: ${formatPeso(nd)}`);
    for (const k of [
      ["Overtime (regular)", p.overtimeRegular],
      ["Overtime (rest day)", p.overtimeRestDay],
      ["Overtime (legal holiday)", p.overtimeLegalHoliday],
      ["Overtime (special holiday)", p.overtimeSpecialHoliday],
    ] as const) {
      const v = num(k[1]);
      if (v > 0) doc.text(`${k[0]}: ${formatPeso(v)}`);
    }
    for (const inc of incentives) {
      if (inc.amount > 0)
        doc.text(`${inc.name}: ${formatPeso(inc.amount)}`);
    }
    const adj = num(p.adjustments);
    if (adj !== 0) doc.text(`Adjustments: ${formatPeso(adj)}`);
    doc.moveDown(0.5);
    doc.fontSize(11).text("Deductions", { underline: true });
    doc.moveDown(0.35);
    doc.fontSize(10);
    for (const d of deductions) {
      if (d.amount > 0) doc.text(`${d.name}: ${formatPeso(d.amount)}`);
    }
    doc.moveDown(0.75);
    doc.fontSize(12).text(`Gross pay: ${formatPeso(gross)}`);
    doc.text(`Net pay: ${formatPeso(net)}`, { continued: false });

    doc.end();
  });
}
