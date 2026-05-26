export type NightDiffCategory =
  | "regular"
  | "regular_ot"
  | "rest_day"
  | "rest_day_ot"
  | "regular_holiday"
  | "regular_holiday_ot"
  | "special_holiday"
  | "special_holiday_ot";

export type NightDiffBreakdownEntry = {
  label: string;
  date: number;
  amount: number;
  category?: NightDiffCategory;
};

const NIGHT_DIFF_CATEGORY_LABELS: Record<NightDiffCategory, string> = {
  regular: "Night Differential - Regular",
  regular_ot: "Night Differential - Regular OT",
  rest_day: "Night Differential - Rest Day",
  rest_day_ot: "Night Differential - Rest Day OT",
  regular_holiday: "Night Differential - Legal Holiday",
  regular_holiday_ot: "Night Differential - Legal Holiday OT",
  special_holiday: "Night Differential - Special Holiday",
  special_holiday_ot: "Night Differential - Special Holiday OT",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(x: unknown): number {
  if (typeof x === "number" && !Number.isNaN(x)) return x;
  if (typeof x === "string") {
    const parsed = parseFloat(x);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function parseNightDiffBreakdown(
  input: unknown,
): NightDiffBreakdownEntry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry: unknown) => {
    const row = entry as Record<string, unknown>;
    const amount = num(row.amount);
    if (amount <= 0) return [];
    return [
      {
        label: typeof row.label === "string" ? row.label : "Night differential",
        date: typeof row.date === "number" ? row.date : 0,
        amount,
        category:
          typeof row.category === "string"
            ? (row.category as NightDiffCategory)
            : undefined,
      },
    ];
  });
}

export function groupNightDiffBreakdownRows(
  input: unknown,
): Array<{ label: string; amount: number }> {
  const entries = parseNightDiffBreakdown(input);
  if (entries.length === 0) return [];

  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const label =
      entry.category != null
        ? NIGHT_DIFF_CATEGORY_LABELS[entry.category] ?? "Night Differential"
        : "Night Differential";
    grouped.set(label, round2((grouped.get(label) ?? 0) + entry.amount));
  }

  return Array.from(grouped.entries()).map(([label, amount]) => ({
    label,
    amount: round2(amount),
  }));
}
