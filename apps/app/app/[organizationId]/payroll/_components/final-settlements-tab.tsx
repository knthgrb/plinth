"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import {
  Banknote,
  Check,
  ClipboardCheck,
  FileCheck2,
  Loader2,
  MinusCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";

type FinalSettlementsTabProps = {
  organizationId: string;
  onLoadPayrollRuns: () => void;
};

type CustomDeductionType =
  | "loan"
  | "company_property"
  | "cash_advance"
  | "training_bond"
  | "other";

const finalSettlementsApi = api.finalSettlements;

function formatCurrency(amount: number | undefined): string {
  return `PHP ${(amount ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function employeeName(employee: any): string {
  return [employee?.personalInfo?.firstName, employee?.personalInfo?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function statusLabel(status: string | undefined): string {
  return String(status ?? "pending")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusClass(status: string | undefined): string {
  if (status === "released" || status === "completed" || status === "reviewed") {
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  }
  if (
    status === "ready_for_payroll" ||
    status === "payroll_generated" ||
    status === "data_ready" ||
    status === "document_generated" ||
    status === "approved"
  ) {
    return "bg-blue-50 text-blue-700 border border-blue-200";
  }
  if (status === "waived") {
    return "bg-gray-100 text-gray-700 border border-gray-200";
  }
  if (status === "void") {
    return "bg-red-50 text-red-700 border border-red-200";
  }
  return "bg-amber-50 text-amber-700 border border-amber-200";
}

export function FinalSettlementsTab({
  organizationId,
  onLoadPayrollRuns,
}: FinalSettlementsTabProps) {
  const { toast } = useToast();
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(
    null,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loanAmountDrafts, setLoanAmountDrafts] = useState<Record<string, string>>(
    {},
  );
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customType, setCustomType] =
    useState<CustomDeductionType>("company_property");

  const settlementData = useQuery(
    finalSettlementsApi.getFinalSettlements,
    organizationId ? { organizationId: organizationId as any } : "skip",
  );
  const prepareFinalSettlement = useMutation(
    finalSettlementsApi.prepareFinalSettlement,
  );
  const updateClearanceItem = useMutation(finalSettlementsApi.updateClearanceItem);
  const upsertLoanPayoff = useMutation(finalSettlementsApi.upsertLoanPayoff);
  const upsertCustomDeduction = useMutation(
    finalSettlementsApi.upsertCustomDeduction,
  );
  const removeCustomDeduction = useMutation(
    finalSettlementsApi.removeCustomDeduction,
  );
  const markFinalSettlementReadyForPayroll = useMutation(
    finalSettlementsApi.markFinalSettlementReadyForPayroll,
  );
  const markBir2316DataReady = useMutation(
    finalSettlementsApi.markBir2316DataReady,
  );
  const markBir2316Released = useMutation(
    finalSettlementsApi.markBir2316Released,
  );
  const markFinalTaxReviewed = useMutation(
    finalSettlementsApi.markFinalTaxReviewed,
  );

  const settlements = settlementData?.settlements ?? [];
  const separatedEmployees = settlementData?.separatedEmployees ?? [];
  const activeSettlement = useMemo(
    () =>
      selectedSettlementId
        ? settlements.find(
            (settlement: any) => String(settlement._id) === selectedSettlementId,
          )
        : null,
    [selectedSettlementId, settlements],
  );

  useEffect(() => {
    if (!activeSettlement) {
      setLoanAmountDrafts({});
      return;
    }
    setLoanAmountDrafts(
      Object.fromEntries(
        (activeSettlement.loanPayoffs ?? []).map((loan: any) => [
          loan.id,
          String(loan.payoffAmount ?? loan.scheduledAmount ?? 0),
        ]),
      ),
    );
  }, [activeSettlement?._id, activeSettlement?.updatedAt]);

  async function runAction(key: string, action: () => Promise<unknown>) {
    setBusyKey(key);
    try {
      await action();
      onLoadPayrollRuns();
      toast({
        title: "Saved",
        description: "Final settlement updated.",
        variant: "success",
      });
    } catch (error: any) {
      toast({
        title: "Could not update settlement",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function addCustomDeduction() {
    const amount = Number(customAmount);
    if (!customName.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast({
        title: "Missing deduction details",
        description: "Enter a deduction name and amount.",
        variant: "destructive",
      });
      return;
    }
    if (!activeSettlement) return;

    await runAction("custom:add", async () => {
      await upsertCustomDeduction({
        settlementId: activeSettlement._id,
        deduction: {
          name: customName.trim(),
          amount,
          type: customType,
        },
      });
      setCustomName("");
      setCustomAmount("");
      setCustomType("company_property");
    });
  }

  const loading = settlementData === undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <CardTitle>Final Settlements</CardTitle>
          <div className="text-sm text-muted-foreground">
            {settlements.length} active settlement
            {settlements.length === 1 ? "" : "s"}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {separatedEmployees.length > 0 && (
            <div className="rounded-md border border-gray-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Separated employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {separatedEmployees.map((employee: any) => (
                    <TableRow key={employee._id}>
                      <TableCell>
                        <div className="font-medium">
                          {employeeName(employee) || employee.employment.employeeId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {statusLabel(employee.employment.status)}
                          {employee.employment.lastWorkingDay
                            ? ` - Last day ${format(new Date(employee.employment.lastWorkingDay), "MMM dd, yyyy")}`
                            : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusClass("pending")}>
                          Not prepared
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === `prepare:${employee._id}`}
                          onClick={() =>
                            void runAction(`prepare:${employee._id}`, async () => {
                              const settlementId = await prepareFinalSettlement({
                                organizationId: organizationId as any,
                                employeeId: employee._id,
                              });
                              setSelectedSettlementId(String(settlementId));
                            })
                          }
                        >
                          {busyKey === `prepare:${employee._id}` ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          Prepare settlement
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="rounded-md border border-gray-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clearance</TableHead>
                  <TableHead>Loan payoff</TableHead>
                  <TableHead>BIR 2316</TableHead>
                  <TableHead>Final tax</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={`settlement-skeleton-${index}`}>
                      <TableCell>
                        <div className="h-4 w-40 rounded bg-gray-200 animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="h-6 w-24 rounded-full bg-gray-200 animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-20 rounded bg-gray-200 animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
                      </TableCell>
                      <TableCell>
                        <div className="ml-auto h-8 w-20 rounded bg-gray-200 animate-pulse" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : settlements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-gray-500">
                      No final settlements found
                    </TableCell>
                  </TableRow>
                ) : (
                  settlements.map((settlement: any) => {
                    const clearance = settlement.summary?.clearance;
                    const completed =
                      (clearance?.completedRequired ?? 0) +
                      (clearance?.waivedRequired ?? 0);
                    const required = clearance?.required ?? 0;
                    return (
                      <TableRow key={settlement._id}>
                        <TableCell>
                          <div className="font-medium">
                            {settlement.employeeName ||
                              employeeName(settlement.employee) ||
                              settlement.employee?.employment?.employeeId}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {settlement.employee?.employment?.position ?? "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={statusClass(settlement.status)}
                          >
                            {statusLabel(settlement.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {completed}/{required}
                        </TableCell>
                        <TableCell>
                          {formatCurrency(settlement.summary?.totalLoanPayoff)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={statusClass(settlement.bir2316?.status)}
                          >
                            {statusLabel(settlement.bir2316?.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={statusClass(
                              settlement.finalTaxRelease?.status,
                            )}
                          >
                            {statusLabel(settlement.finalTaxRelease?.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setSelectedSettlementId(String(settlement._id))
                            }
                          >
                            Review
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!activeSettlement}
        onOpenChange={(open) => {
          if (!open) setSelectedSettlementId(null);
        }}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {activeSettlement && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Final settlement -{" "}
                  {activeSettlement.employeeName ||
                    employeeName(activeSettlement.employee)}
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-4">
                  <section className="rounded-md border border-gray-200">
                    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        <ClipboardCheck className="h-4 w-4" />
                        Clearance
                      </div>
                      <Badge
                        variant="secondary"
                        className={statusClass(activeSettlement.status)}
                      >
                        {statusLabel(activeSettlement.status)}
                      </Badge>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {(activeSettlement.clearanceItems ?? []).map((item: any) => (
                        <div
                          key={item.id}
                          className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]"
                        >
                          <div>
                            <div className="font-medium">{item.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.ownerRole ?? "owner"} -{" "}
                              {item.required ? "Required" : "Optional"}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="secondary"
                              className={statusClass(item.status)}
                            >
                              {statusLabel(item.status)}
                            </Badge>
                            <Button
                              size="icon"
                              variant="outline"
                              disabled={busyKey === `clear:${item.id}`}
                              title="Complete"
                              onClick={() =>
                                void runAction(`clear:${item.id}`, () =>
                                  updateClearanceItem({
                                    settlementId: activeSettlement._id,
                                    itemId: item.id,
                                    status: "completed",
                                  }),
                                )
                              }
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              disabled={busyKey === `waive:${item.id}`}
                              title="Waive"
                              onClick={() =>
                                void runAction(`waive:${item.id}`, () =>
                                  updateClearanceItem({
                                    settlementId: activeSettlement._id,
                                    itemId: item.id,
                                    status: "waived",
                                  }),
                                )
                              }
                            >
                              <MinusCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busyKey === `reset:${item.id}`}
                              title="Reset"
                              onClick={() =>
                                void runAction(`reset:${item.id}`, () =>
                                  updateClearanceItem({
                                    settlementId: activeSettlement._id,
                                    itemId: item.id,
                                    status: "pending",
                                  }),
                                )
                              }
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-md border border-gray-200">
                    <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 font-medium">
                      <Banknote className="h-4 w-4" />
                      Loan payoff
                    </div>
                    <div className="divide-y divide-gray-100">
                      {(activeSettlement.loanPayoffs ?? []).length === 0 ? (
                        <div className="px-4 py-6 text-sm text-muted-foreground">
                          No active loan deductions
                        </div>
                      ) : (
                        (activeSettlement.loanPayoffs ?? []).map((loan: any) => (
                          <div key={loan.id} className="grid gap-3 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="font-medium">{loan.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  Scheduled {formatCurrency(loan.scheduledAmount)}
                                </div>
                              </div>
                              <Badge
                                variant="secondary"
                                className={statusClass(loan.status)}
                              >
                                {statusLabel(loan.status)}
                              </Badge>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[140px_180px_auto_auto]">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={loanAmountDrafts[loan.id] ?? ""}
                                onChange={(event) =>
                                  setLoanAmountDrafts((prev) => ({
                                    ...prev,
                                    [loan.id]: event.target.value,
                                  }))
                                }
                              />
                              <Select
                                value={loan.rule}
                                onValueChange={(rule) =>
                                  void runAction(`loan-rule:${loan.id}`, () =>
                                    upsertLoanPayoff({
                                      settlementId: activeSettlement._id,
                                      loanPayoff: {
                                        ...loan,
                                        payoffAmount: Number(
                                          loanAmountDrafts[loan.id] ??
                                            loan.payoffAmount ??
                                            0,
                                        ),
                                        rule,
                                      },
                                    }),
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="deduct_scheduled_amount">
                                    Scheduled amount
                                  </SelectItem>
                                  <SelectItem value="deduct_full_balance">
                                    Full balance
                                  </SelectItem>
                                  <SelectItem value="custom_amount">
                                    Custom amount
                                  </SelectItem>
                                  <SelectItem value="waive">Waive</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyKey === `loan:${loan.id}`}
                                onClick={() =>
                                  void runAction(`loan:${loan.id}`, () =>
                                    upsertLoanPayoff({
                                      settlementId: activeSettlement._id,
                                      loanPayoff: {
                                        ...loan,
                                        payoffAmount: Number(
                                          loanAmountDrafts[loan.id] ??
                                            loan.payoffAmount ??
                                            0,
                                        ),
                                        status: "approved",
                                      },
                                    }),
                                  )
                                }
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyKey === `loan-waive:${loan.id}`}
                                onClick={() =>
                                  void runAction(`loan-waive:${loan.id}`, () =>
                                    upsertLoanPayoff({
                                      settlementId: activeSettlement._id,
                                      loanPayoff: {
                                        ...loan,
                                        rule: "waive",
                                        status: "waived",
                                      },
                                    }),
                                  )
                                }
                              >
                                Waive
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                <div className="space-y-4">
                  <section className="rounded-md border border-gray-200">
                    <div className="border-b border-gray-200 px-4 py-3 font-medium">
                      Custom separation deductions
                    </div>
                    <div className="space-y-3 p-4">
                      {(activeSettlement.customDeductions ?? []).map(
                        (deduction: any) => (
                          <div
                            key={deduction.id}
                            className="grid gap-2 rounded-md border border-gray-100 p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="font-medium">
                                  {deduction.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {statusLabel(deduction.type)}
                                </div>
                              </div>
                              <div className="text-right font-medium">
                                {formatCurrency(deduction.amount)}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="justify-self-start text-red-600"
                              disabled={busyKey === `custom:${deduction.id}`}
                              onClick={() =>
                                void runAction(`custom:${deduction.id}`, () =>
                                  removeCustomDeduction({
                                    settlementId: activeSettlement._id,
                                    deductionId: deduction.id,
                                  }),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ),
                      )}
                      <div className="grid gap-2">
                        <Input
                          value={customName}
                          placeholder="Deduction name"
                          onChange={(event) => setCustomName(event.target.value)}
                        />
                        <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={customAmount}
                            placeholder="Amount"
                            onChange={(event) =>
                              setCustomAmount(event.target.value)
                            }
                          />
                          <Select
                            value={customType}
                            onValueChange={(value) =>
                              setCustomType(value as CustomDeductionType)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="company_property">
                                Company property
                              </SelectItem>
                              <SelectItem value="cash_advance">
                                Cash advance
                              </SelectItem>
                              <SelectItem value="training_bond">
                                Training bond
                              </SelectItem>
                              <SelectItem value="loan">Loan</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyKey === "custom:add"}
                          onClick={() => void addCustomDeduction()}
                        >
                          {busyKey === "custom:add" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          Add deduction
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-md border border-gray-200">
                    <div className="border-b border-gray-200 px-4 py-3 font-medium">
                      BIR 2316
                    </div>
                    <div className="space-y-3 p-4">
                      <Badge
                        variant="secondary"
                        className={statusClass(activeSettlement.bir2316?.status)}
                      >
                        {statusLabel(activeSettlement.bir2316?.status)}
                      </Badge>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === "bir:data"}
                          onClick={() =>
                            void runAction("bir:data", () =>
                              markBir2316DataReady({
                                settlementId: activeSettlement._id,
                              }),
                            )
                          }
                        >
                          <FileCheck2 className="mr-2 h-4 w-4" />
                          Data ready
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyKey === "bir:release"}
                          onClick={() =>
                            void runAction("bir:release", () =>
                              markBir2316Released({
                                settlementId: activeSettlement._id,
                              }),
                            )
                          }
                        >
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          Released
                        </Button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-md border border-gray-200">
                    <div className="border-b border-gray-200 px-4 py-3 font-medium">
                      Final tax
                    </div>
                    <div className="space-y-3 p-4">
                      <Badge
                        variant="secondary"
                        className={statusClass(
                          activeSettlement.finalTaxRelease?.status,
                        )}
                      >
                        {statusLabel(activeSettlement.finalTaxRelease?.status)}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyKey === "tax:review"}
                        onClick={() =>
                          void runAction("tax:review", () =>
                            markFinalTaxReviewed({
                              settlementId: activeSettlement._id,
                            }),
                          )
                        }
                      >
                        <FileCheck2 className="mr-2 h-4 w-4" />
                        Mark reviewed
                      </Button>
                    </div>
                  </section>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedSettlementId(null)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={busyKey === "ready"}
                  onClick={() =>
                    void runAction("ready", () =>
                      markFinalSettlementReadyForPayroll({
                        settlementId: activeSettlement._id,
                      }),
                    )
                  }
                >
                  {busyKey === "ready" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                  )}
                  Mark ready for payroll
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
