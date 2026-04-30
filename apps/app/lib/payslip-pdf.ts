import "server-only";

import PDFDocument from "pdfkit";
import { getPayslipPdfOpenPassword } from "@/lib/payslip-pdf-password";
import {
  formatManilaLongDate,
  formatManilaNumericDate,
  formatManilaShortDate,
  formatManilaShortMonthDay,
  getManilaDateParts,
} from "@/lib/manila-date";

/** Matches Plinth primary accent (#695eff) */
const NET_PAY_PURPLE = "#695EFF";
const MUTED = "#6B7280";
const TEXT = "#111827";
const RULE = "#D1D5DB";

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

/** Positive earnings line — explicit leading + for readability */
function formatPesoPlus(n: number): string {
  if (n <= 0) return formatPeso(n);
  return `+${formatPeso(n)}`;
}

const MINUS = "\u2212";

function isAttendanceLikeDeduction(d: {
  name: string;
  type: string;
  amount: number;
}): boolean {
  return (
    d.amount > 0 &&
    (d.type === "attendance" ||
      /^(absent|late|undertime|no-?work|no\s+work)/i.test(d.name || ""))
  );
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
): Array<{ name: string; amount: number; type?: string; taxable?: boolean }> {
  if (Array.isArray(d)) {
    return d.map((x: unknown) => {
      const row = x as Record<string, unknown>;
      return {
        name: String(row.name ?? ""),
        amount: num(row.amount),
        type: row.type != null ? String(row.type) : undefined,
        taxable: row.taxable === false ? false : true,
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
              taxable: row.taxable === false ? false : true,
            };
          })
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeDeductionKey(name: string): string {
  return (name || "").trim().toLowerCase();
}

function isGovernmentDeductionName(name: string): boolean {
  const n = normalizeDeductionKey(name);
  return (
    n === "sss" ||
    n === "philhealth" ||
    n === "pag-ibig" ||
    n === "pagibig" ||
    n === "withholding tax"
  );
}

const GOV_SORT_ORDER = ["sss", "philhealth", "pag-ibig", "withholding tax"];

function sortGovernmentDeductions(
  rows: Array<{ name: string; amount: number; type: string }>,
): typeof rows {
  const gov = rows.filter((r) => isGovernmentDeductionName(r.name));
  const rank = (name: string) => {
    const k = normalizeDeductionKey(name);
    const i = GOV_SORT_ORDER.indexOf(k);
    return i >= 0 ? i : 99;
  };
  gov.sort((a, b) => rank(a.name) - rank(b.name));
  return gov;
}

function computePayDateLong(
  cutoffEnd: number,
  paySchedule?: {
    firstPayDate: number;
    secondPayDate: number;
    salaryPaymentFrequency: "monthly" | "bimonthly";
  },
): string {
  const firstPayDate = paySchedule?.firstPayDate ?? 15;
  const secondPayDate = paySchedule?.secondPayDate ?? 30;
  const isMonthly = paySchedule?.salaryPaymentFrequency === "monthly";

  const cutoffEndParts = getManilaDateParts(cutoffEnd);
  const cutoffMonth = cutoffEndParts.monthIndex;
  const cutoffYear = cutoffEndParts.year;
  const cutoffDay = cutoffEndParts.day;

  let payDay: number;
  if (isMonthly) {
    payDay = firstPayDate;
  } else if (cutoffDay <= 15) {
    payDay = firstPayDate;
  } else {
    payDay = secondPayDate;
  }

  const lastDayOfMonth = new Date(cutoffYear, cutoffMonth + 1, 0).getDate();
  const actualPayDay = Math.min(payDay, lastDayOfMonth);
  const payDateMs = Date.UTC(cutoffYear, cutoffMonth, actualPayDay);
  return formatManilaLongDate(payDateMs);
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
      hireDate?: number;
    };
  };
  organizationName: string;
  cutoffStart: number;
  cutoffEnd: number;
  paySchedule?: {
    firstPayDate: number;
    secondPayDate: number;
    salaryPaymentFrequency: "monthly" | "bimonthly";
  };
}): Promise<Buffer> {
  const userPassword = getPayslipPdfOpenPassword(args.employee);
  const ownerPassword =
    process.env.PAYSLIP_PDF_OWNER_PASSWORD ||
    `plinth-owner-${process.env.CONVEX_DEPLOYMENT ?? "dev"}`;

  const p = args.payslip;
  const deductions = asDeductionArray(p.deductions).filter((d) => d.amount > 0);
  const incentives = asIncentiveArray(p.incentives);
  const gross = num(p.grossPay);
  const net = num(p.netPay);
  const taxableGrossStored = num(p.taxableGrossEarnings);
  const totalEarningsStored = num(p.totalEarnings);

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

  const taxableIncentiveLines = incentives.filter(
    (i) => i.amount > 0 && i.taxable !== false,
  );
  const nonTaxableIncentiveLines = incentives.filter(
    (i) => i.amount > 0 && i.taxable === false,
  );

  const hireDateMs = args.employee.employment.hireDate;
  const dateHiredDisplay =
    typeof hireDateMs === "number" && !Number.isNaN(hireDateMs)
      ? formatManilaLongDate(hireDateMs)
      : "N/A";

  const cutoffDisplay = `${formatManilaShortMonthDay(args.cutoffStart)} - ${formatManilaShortDate(args.cutoffEnd)}`;
  const payDateDisplay = computePayDateLong(args.cutoffEnd, args.paySchedule);

  const employeeName = `${args.employee.personalInfo.firstName} ${args.employee.personalInfo.lastName}`.trim();
  const designation = args.employee.employment.position?.trim() || "N/A";

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

    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const right = left + pageWidth;
    const colGap = 20;
    const colWidth = (pageWidth - colGap) / 2;
    const earnX = left;
    const dedX = left + colWidth + colGap;
    const rowH = 14;
    const subRowH = 13;

    const drawRuleFull = (y: number, width = 0.75, color = RULE) => {
      doc
        .save()
        .moveTo(left, y)
        .lineTo(right, y)
        .lineWidth(width)
        .strokeColor(color)
        .stroke()
        .restore();
    };

    const drawRuleThin = (x: number, y: number, w: number) => {
      doc
        .save()
        .moveTo(x, y)
        .lineTo(x + w, y)
        .lineWidth(0.35)
        .strokeColor("#E5E7EB")
        .stroke()
        .restore();
    };

    /** Label left, amount right within column width */
    const rowAmount = (
      x: number,
      y: number,
      w: number,
      label: string,
      amountStr: string,
      opts?: { labelBold?: boolean; size?: number; valueBold?: boolean },
    ): number => {
      const fs = opts?.size ?? 9;
      doc
        .font(opts?.labelBold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fs)
        .fillColor(TEXT)
        .text(label, x, y, { width: w * 0.58 });
      doc
        .font(opts?.valueBold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fs)
        .fillColor(TEXT)
        .text(amountStr, x + w * 0.42, y, {
          width: w * 0.58,
          align: "right",
        });
      return y + rowH;
    };

    /** Deduction / reduction shown in earnings column (Unicode minus + peso) */
    const rowAmountMinus = (
      x: number,
      y: number,
      w: number,
      label: string,
      amount: number,
      opts?: { size?: number },
    ): number => {
      const fs = opts?.size ?? 9;
      const amountStr = `${MINUS}${formatPeso(amount)}`;
      doc
        .font("Helvetica")
        .fontSize(fs)
        .fillColor(TEXT)
        .text(label, x, y, { width: w * 0.58 });
      doc
        .font("Helvetica")
        .fontSize(fs)
        .fillColor(TEXT)
        .text(amountStr, x + w * 0.42, y, {
          width: w * 0.58,
          align: "right",
        });
      return y + rowH;
    };

    const periodLine = `${formatManilaNumericDate(args.cutoffStart)} to ${formatManilaNumericDate(args.cutoffEnd)}`;

    const orgDisplay = String(args.organizationName ?? "").trim() || "—";

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(TEXT)
      .text("PAYSLIP", left, doc.y, { width: pageWidth, align: "center" });
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(MUTED)
      .text(orgDisplay, left, doc.y, { width: pageWidth, align: "center" });
    doc.moveDown(0.15);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(periodLine, left, doc.y, { width: pageWidth, align: "center" });
    doc.moveDown(0.75);

    const infoTop = doc.y;
    const labelFs = 8;
    const valueFs = 9;
    const splitMid = left + pageWidth / 2;

    const leftLabels = ["Name", "Employee ID", "Designation"];
    const leftValues = [
      employeeName,
      args.employee.employment.employeeId || "N/A",
      designation,
    ];
    const rightLabels = ["Date Hired", "Cut off Date", "Pay Date"];
    const rightValues = [dateHiredDisplay, cutoffDisplay, payDateDisplay];

    let iy = infoTop;
    for (let i = 0; i < 3; i++) {
      doc
        .font("Helvetica")
        .fontSize(labelFs)
        .fillColor(MUTED)
        .text(leftLabels[i], left, iy, { width: splitMid - left - 8 });
      doc
        .font("Helvetica-Bold")
        .fontSize(valueFs)
        .fillColor(TEXT)
        .text(leftValues[i], left, iy + 11, {
          width: splitMid - left - 8,
        });
      doc
        .font("Helvetica")
        .fontSize(labelFs)
        .fillColor(MUTED)
        .text(rightLabels[i], splitMid, iy, {
          width: right - splitMid - 8,
        });
      doc
        .font("Helvetica-Bold")
        .fontSize(valueFs)
        .fillColor(TEXT)
        .text(rightValues[i], splitMid, iy + 11, {
          width: right - splitMid - 8,
        });
      iy += 34;
    }

    doc.y = iy + 6;
    drawRuleFull(doc.y);
    doc.moveDown(0.6);

    const sectionTop = doc.y;

    const govRows = sortGovernmentDeductions(deductions);
    const otherDeductionRows = deductions.filter(
      (d) =>
        !isGovernmentDeductionName(d.name) &&
        !isAttendanceLikeDeduction(d),
    );
    const deductionTotal = deductions.reduce((s, d) => s + d.amount, 0);

    const attendanceDeductionRows = deductions.filter(isAttendanceLikeDeduction);

    const basic = num(p.basicPay);
    const taxableGrossLine =
      taxableGrossStored > 0 ? taxableGrossStored : gross;

    let ye = sectionTop;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(TEXT)
      .text("EARNINGS", earnX, ye, { width: colWidth });
    ye += 18;

    ye = rowAmount(earnX, ye, colWidth, "Basic Pay", formatPesoPlus(basic));

    const adj = num(p.adjustments);
    const lessLineItems: Array<{ label: string; amount: number }> = [
      ...attendanceDeductionRows.map((d) => ({
        label: d.name?.trim() || "Attendance deduction",
        amount: d.amount,
      })),
    ];
    if (adj < 0) {
      lessLineItems.push({
        label: "Adjustments",
        amount: Math.abs(adj),
      });
    }

    if (lessLineItems.length > 0) {
      ye += 4;
      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text("Less:", earnX, ye, { width: colWidth });
      ye += subRowH;
      for (const row of lessLineItems) {
        ye = rowAmountMinus(earnX, ye, colWidth, row.label, row.amount);
      }
    }

    const taxableExtras: Array<{ label: string; amount: number }> = [];
    const hp = num(p.holidayPay);
    if (hp > 0) taxableExtras.push({ label: "Holiday pay", amount: hp });
    const rd = num(p.restDayPay);
    if (rd > 0) taxableExtras.push({ label: "Rest day premium", amount: rd });
    const nd = num(p.nightDiffPay);
    if (nd > 0) taxableExtras.push({ label: "Night differential", amount: nd });
    for (const [label, key] of [
      ["Overtime — regular", p.overtimeRegular],
      ["Overtime — rest day", p.overtimeRestDay],
      ["Overtime — RD over 8 hrs", p.overtimeRestDayExcess],
      ["Overtime — special holiday", p.overtimeSpecialHoliday],
      ["Overtime — special holiday over 8 hrs", p.overtimeSpecialHolidayExcess],
      ["Overtime — legal holiday", p.overtimeLegalHoliday],
      ["Overtime — legal holiday over 8 hrs", p.overtimeLegalHolidayExcess],
    ] as const) {
      const n = num(key);
      if (n > 0) taxableExtras.push({ label, amount: n });
    }
    for (const inc of taxableIncentiveLines) {
      if (inc.amount > 0)
        taxableExtras.push({ label: inc.name || "Incentive", amount: inc.amount });
    }
    if (adj > 0) {
      taxableExtras.push({
        label: "Adjustments",
        amount: adj,
      });
    }

    for (const row of taxableExtras) {
      ye = rowAmount(
        earnX,
        ye,
        colWidth,
        row.label,
        formatPesoPlus(row.amount),
      );
    }

    drawRuleThin(earnX, ye + 2, colWidth);
    ye += 10;

    ye = rowAmount(earnX, ye, colWidth, "Taxable Gross Earnings", formatPeso(taxableGrossLine), {
      labelBold: true,
      valueBold: true,
    });

    const hasNontaxSection =
      allowance > 0 || nonTaxableIncentiveLines.length > 0;
    if (hasNontaxSection) {
      ye += 4;
      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text("Add (non-taxable):", earnX, ye, { width: colWidth });
      ye += subRowH;

      if (allowance > 0) {
        ye = rowAmount(
          earnX,
          ye,
          colWidth,
          "Non-taxable Allowance",
          formatPesoPlus(allowance),
          { size: 9 },
        );
      }
      for (const inc of nonTaxableIncentiveLines) {
        ye = rowAmount(
          earnX,
          ye,
          colWidth,
          inc.name || "Addition",
          formatPesoPlus(inc.amount),
          { size: 9 },
        );
      }
    }

    drawRuleThin(earnX, ye + 2, colWidth);
    ye += 10;

    const totalEarnings =
      totalEarningsStored > 0
        ? totalEarningsStored
        : gross + allowance + nonTaxableIncentiveLines.reduce((s, i) => s + i.amount, 0);

    ye = rowAmount(earnX, ye, colWidth, "Total", formatPeso(totalEarnings), {
      labelBold: true,
      valueBold: true,
      size: 10,
    });

    let yd = sectionTop;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(TEXT)
      .text("DEDUCTIONS", dedX, yd, { width: colWidth });
    yd += 18;

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(MUTED)
      .text("Government Deductions", dedX, yd, { width: colWidth });
    yd += subRowH;

    if (govRows.length === 0) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(MUTED)
        .text("—", dedX, yd, { width: colWidth });
      yd += rowH;
    } else {
      for (const d of govRows) {
        yd = rowAmount(dedX, yd, colWidth, d.name, formatPeso(d.amount));
      }
    }

    if (otherDeductionRows.length > 0) {
      yd += 4;
      doc
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text("Other", dedX, yd, { width: colWidth });
      yd += subRowH;
      for (const d of otherDeductionRows) {
        yd = rowAmount(dedX, yd, colWidth, d.name, formatPeso(d.amount));
      }
    }

    drawRuleThin(dedX, yd + 2, colWidth);
    yd += 10;

    yd = rowAmount(
      dedX,
      yd,
      colWidth,
      "Total",
      formatPeso(deductionTotal),
      {
        labelBold: true,
        valueBold: true,
        size: 10,
      },
    );

    const footerY = Math.max(ye, yd) + 16;
    drawRuleFull(footerY);
    const netRowY = footerY + 14;

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(TEXT)
      .text("Net Pay", left, netRowY, { width: pageWidth * 0.45 });
    doc
      .font("Helvetica-Bold")
      .fontSize(17)
      .fillColor(NET_PAY_PURPLE)
      .text(formatPeso(net), left + pageWidth * 0.45, netRowY - 3, {
        width: pageWidth * 0.55,
        align: "right",
      });

    doc.end();
  });
}
