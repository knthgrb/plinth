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

    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const right = left + pageWidth;
    const rowLineHeight = 15;
    const tableColSplit = left + pageWidth * 0.67;

    const drawRule = (y: number) => {
      doc
        .save()
        .moveTo(left, y)
        .lineTo(right, y)
        .lineWidth(0.6)
        .strokeColor("#E5E7EB")
        .stroke()
        .restore();
    };
    const drawSectionTitle = (title: string) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#374151")
        .text(title, left, doc.y);
      doc.moveDown(0.2);
      drawRule(doc.y);
      doc.moveDown(0.35);
    };
    const drawLabelValue = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#374151")
        .text(label, left, y, { width: tableColSplit - left - 8 });
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9.5)
        .fillColor("#111827")
        .text(value, tableColSplit, y, { width: right - tableColSplit, align: "right" });
      doc.y = y + rowLineHeight;
    };

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text("PAYSLIP", left, doc.y, {
      width: pageWidth,
      align: "center",
    });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#4B5563")
      .text(args.organizationName, left, doc.y + 2, { width: pageWidth, align: "center" });
    doc.moveDown(1);

    drawSectionTitle("Employee Information");
    drawLabelValue(
      "Employee",
      `${args.employee.personalInfo.firstName} ${args.employee.personalInfo.lastName}`,
    );
    drawLabelValue("Employee ID", args.employee.employment.employeeId || "N/A");
    drawLabelValue("Department", args.employee.employment.department || "N/A");
    drawLabelValue("Position", args.employee.employment.position || "N/A");
    drawLabelValue("Pay period", period || "N/A");
    drawLabelValue("Cutoff", `${start} - ${end}`);
    drawLabelValue("Days worked", String(daysWorked));
    drawLabelValue("Absences", String(absences));
    doc.moveDown(0.3);

    drawSectionTitle("Earnings");
    const earningRows: Array<{ label: string; amount: number }> = [];
    const basic = num(p.basicPay);
    if (basic > 0) earningRows.push({ label: "Basic pay", amount: basic });
    // Absence deduction can overflow past the taxable gross and reduce the non-taxable
    // allowance the employee actually takes home. Mirror the on-screen payslip so the
    // PDF agrees with the screen total when absences consume everything.
    const rawAllowance = num(p.nonTaxableAllowance);
    const attendanceDeductionsTotal = deductions
      .filter(
        (d) =>
          d.type === "attendance" ||
          /^(absent|late|undertime|no-?work|no\s+work)/i.test(d.name || ""),
      )
      .reduce((sum, d) => sum + d.amount, 0);
    const unabsorbedAbsence = Math.max(0, attendanceDeductionsTotal - gross);
    const allowance = Math.max(0, rawAllowance - unabsorbedAbsence);
    if (allowance > 0) {
      earningRows.push({ label: "Non-taxable allowance", amount: allowance });
    }
    const hp = num(p.holidayPay);
    if (hp > 0) earningRows.push({ label: "Holiday pay", amount: hp });
    const rd = num(p.restDayPay);
    if (rd > 0) earningRows.push({ label: "Rest day pay", amount: rd });
    const nd = num(p.nightDiffPay);
    if (nd > 0) earningRows.push({ label: "Night differential", amount: nd });
    for (const [label, value] of [
      ["Overtime (regular)", p.overtimeRegular],
      ["Overtime (rest day)", p.overtimeRestDay],
      ["Overtime (legal holiday)", p.overtimeLegalHoliday],
      ["Overtime (special holiday)", p.overtimeSpecialHoliday],
    ] as const) {
      const n = num(value);
      if (n > 0) earningRows.push({ label, amount: n });
    }
    for (const inc of incentives) {
      if (inc.amount > 0) earningRows.push({ label: inc.name, amount: inc.amount });
    }
    const adj = num(p.adjustments);
    if (adj !== 0) earningRows.push({ label: "Adjustments", amount: adj });
    if (earningRows.length === 0) drawLabelValue("No earnings rows", formatPeso(0));
    for (const row of earningRows) drawLabelValue(row.label, formatPeso(row.amount));
    drawRule(doc.y);
    doc.moveDown(0.2);
    drawLabelValue("Gross pay", formatPeso(gross), true);
    doc.moveDown(0.3);

    drawSectionTitle("Deductions");
    const deductionRows = deductions.filter((d) => d.amount > 0);
    if (deductionRows.length === 0) drawLabelValue("No deductions", formatPeso(0));
    for (const d of deductionRows) drawLabelValue(d.name, formatPeso(d.amount));
    const deductionTotal = deductionRows.reduce((sum, d) => sum + d.amount, 0);
    drawRule(doc.y);
    doc.moveDown(0.2);
    drawLabelValue("Total deductions", formatPeso(deductionTotal), true);

    doc.moveDown(0.75);
    drawRule(doc.y);
    doc.moveDown(0.35);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#111827")
      .text("NET PAY", left, doc.y, { width: tableColSplit - left - 8 });
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor("#111827")
      .text(formatPeso(net), tableColSplit, doc.y - 1, {
        width: right - tableColSplit,
        align: "right",
      });

    doc.end();
  });
}
