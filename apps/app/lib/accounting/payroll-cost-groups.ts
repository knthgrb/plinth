export const PAYROLL_COST_COMPONENTS = [
  { type: "payroll", label: "Employee net pay", prefix: "Payroll - " },
  { type: "sss", label: "SSS payable", prefix: "SSS - " },
  { type: "pagibig", label: "Pag-IBIG payable", prefix: "Pag-IBIG - " },
  {
    type: "philhealth",
    label: "PhilHealth payable",
    prefix: "PhilHealth - ",
  },
  {
    type: "tax",
    label: "Withholding tax payable",
    prefix: "Tax Employee Deductions - ",
  },
] as const;

export type PayrollCostComponentType =
  (typeof PAYROLL_COST_COMPONENTS)[number]["type"];

export type PayrollCostItemInput = {
  id: string;
  payrollRunId?: string;
  sourceType?: string;
  name: string;
  amount?: number;
  amountPaid?: number;
  status?: string;
  updatedAt?: number;
  createdAt?: number;
};

export type PayrollCostRunInput = {
  id: string;
  status: string;
  runType?: string;
  period?: string;
  employeeCount?: number;
  updatedAt?: number;
  createdAt?: number;
};

export type PayrollCostComponent<TItem extends PayrollCostItemInput> = {
  type: PayrollCostComponentType;
  label: string;
  item: TItem;
};

export type PayrollCostGroup<TItem extends PayrollCostItemInput> = {
  key: string;
  payrollRunId?: string;
  period: string;
  runStatus?: string;
  runType?: string;
  employeeCount?: number;
  components: PayrollCostComponent<TItem>[];
  total: number;
  paidTotal: number;
  remaining: number;
  status: "missing" | "pending" | "partial" | "paid";
  updatedAt: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getPayrollCostComponent(name?: string | null) {
  if (!name) return null;
  return (
    PAYROLL_COST_COMPONENTS.find((component) =>
      name.startsWith(component.prefix),
    ) ?? null
  );
}

export function isPayrollGeneratedCostItem(
  item: Pick<PayrollCostItemInput, "name" | "sourceType">,
): boolean {
  return (
    item.sourceType === "payroll_run" ||
    getPayrollCostComponent(item.name) !== null
  );
}

export function getPayrollCostPeriod(name: string): string {
  const component = getPayrollCostComponent(name);
  return component ? name.slice(component.prefix.length) : name;
}

export function groupPayrollCostItems<TItem extends PayrollCostItemInput>(
  items: TItem[],
  runs: PayrollCostRunInput[],
): PayrollCostGroup<TItem>[] {
  type MutableGroup = Omit<
    PayrollCostGroup<TItem>,
    "total" | "paidTotal" | "remaining" | "status"
  >;
  const groups = new Map<string, MutableGroup>();
  const periodToKey = new Map<string, string>();

  for (const item of items) {
    const component = getPayrollCostComponent(item.name);
    if (!component) continue;
    const period = getPayrollCostPeriod(item.name);
    const key = item.payrollRunId
      ? `run:${item.payrollRunId}`
      : `period:${period}`;
    const group = groups.get(key) ?? {
      key,
      payrollRunId: item.payrollRunId,
      period,
      components: [],
      updatedAt: item.updatedAt ?? item.createdAt ?? 0,
    };
    group.components.push({
      type: component.type,
      label: component.label,
      item,
    });
    group.updatedAt = Math.max(
      group.updatedAt,
      item.updatedAt ?? item.createdAt ?? 0,
    );
    groups.set(key, group);
    periodToKey.set(period, key);
  }

  for (const run of runs) {
    if (run.status !== "finalized" && run.status !== "paid") continue;
    const period = run.period ?? "Payroll run";
    const runKey = `run:${run.id}`;
    const legacyKey = periodToKey.get(period);
    const group = groups.get(runKey) ?? (legacyKey ? groups.get(legacyKey) : undefined);
    if (group) {
      group.payrollRunId = run.id;
      group.runStatus = run.status;
      group.runType = run.runType ?? "regular";
      group.employeeCount = run.employeeCount;
      continue;
    }
    groups.set(runKey, {
      key: runKey,
      payrollRunId: run.id,
      period,
      runStatus: run.status,
      runType: run.runType ?? "regular",
      employeeCount: run.employeeCount,
      components: [],
      updatedAt: run.updatedAt ?? run.createdAt ?? 0,
    });
  }

  return Array.from(groups.values())
    .map((group): PayrollCostGroup<TItem> => {
      const total = roundCurrency(
        group.components.reduce(
          (sum, component) => sum + (component.item.amount ?? 0),
          0,
        ),
      );
      const paidTotal = roundCurrency(
        group.components.reduce(
          (sum, component) => sum + (component.item.amountPaid ?? 0),
          0,
        ),
      );
      const remaining = roundCurrency(Math.max(0, total - paidTotal));
      const status =
        group.components.length === 0
          ? "missing"
          : remaining <= 0
            ? "paid"
            : paidTotal > 0
              ? "partial"
              : "pending";
      return { ...group, total, paidTotal, remaining, status };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
