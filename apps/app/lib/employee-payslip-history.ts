export function filterPayslipsByMonth<T extends { createdAt: number }>(
  payslips: readonly T[],
  selectedMonth: string,
): T[] {
  if (!selectedMonth) return [...payslips];

  return payslips.filter((payslip) => {
    const date = new Date(payslip.createdAt);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1,
    ).padStart(2, "0")}`;
    return monthKey === selectedMonth;
  });
}
