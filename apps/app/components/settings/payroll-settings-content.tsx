"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

function LabelWithHelp({
  id,
  label,
  tooltip,
}: {
  id: string;
  label: string;
  tooltip: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
            aria-label="How is this calculated?"
          >
            <span className="text-[10px] font-semibold">?</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          position="top"
          className="min-w-[320px] max-w-[400px] whitespace-normal text-left"
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function PayrollSettingsContent() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const organization = useQuery(
    (api as any).organizations.getOrganization,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const updatePayrollSettings = useMutation(
    (api as any).settings.updatePayrollSettings,
  );
  const updateOrganization = useMutation(
    (api as any).organizations.updateOrganization,
  );

  const [formData, setFormData] = useState({
    nightDiffPercent: 10,
    regularHolidayRate: 100,
    specialHolidayRate: 30,
    overtimeRegularRate: 25,
    overtimeRestDayRate: 30,
    dailyRateIncludesAllowance: true,
    dailyRateWorkingDaysPerYear: 261,
    salaryPaymentFrequency: "bimonthly" as "monthly" | "bimonthly",
    firstPayDate: 15,
    secondPayDate: 30,
    taxDeductionFrequency: "twice_per_month" as
      | "once_per_month"
      | "twice_per_month",
    taxDeductOnPay: "first" as "first" | "second",
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const ps = settings?.payrollSettings;
    const taxFreq = ps?.taxDeductionFrequency ?? "twice_per_month";
    const taxPay = ps?.taxDeductOnPay ?? "first";
    if (ps) {
      setFormData({
        nightDiffPercent: parseFloat(
          (((ps.nightDiffPercent ?? 1.1) - 1) * 100).toFixed(2),
        ),
        regularHolidayRate: parseFloat(
          (((ps.regularHolidayRate ?? 2.0) - 1) * 100).toFixed(2),
        ),
        specialHolidayRate: parseFloat(
          (((ps.specialHolidayRate ?? 1.3) - 1) * 100).toFixed(2),
        ),
        overtimeRegularRate: parseFloat(
          (((ps.overtimeRegularRate ?? 1.25) - 1) * 100).toFixed(2),
        ),
        overtimeRestDayRate: parseFloat(
          (((ps.overtimeRestDayRate ?? 1.3) - 1) * 100).toFixed(2),
        ),
        dailyRateIncludesAllowance: ps.dailyRateIncludesAllowance ?? true,
        dailyRateWorkingDaysPerYear: ps.dailyRateWorkingDaysPerYear ?? 261,
        salaryPaymentFrequency:
          organization?.salaryPaymentFrequency === "monthly"
            ? "monthly"
            : "bimonthly",
        firstPayDate: organization?.firstPayDate ?? 15,
        secondPayDate: organization?.secondPayDate ?? 30,
        taxDeductionFrequency: taxFreq,
        taxDeductOnPay: taxPay,
      });
    } else {
      setFormData((prev) => ({
        ...prev,
        salaryPaymentFrequency:
          organization?.salaryPaymentFrequency === "monthly"
            ? "monthly"
            : "bimonthly",
        firstPayDate: organization?.firstPayDate ?? 15,
        secondPayDate: organization?.secondPayDate ?? 30,
        taxDeductionFrequency: taxFreq,
        taxDeductOnPay: taxPay,
      }));
    }
  }, [settings, organization]);

  const handleSave = async () => {
    if (!currentOrganizationId) return;
    setIsSaving(true);
    try {
      await updatePayrollSettings({
        organizationId: currentOrganizationId,
        payrollSettings: {
          nightDiffPercent: 1 + formData.nightDiffPercent / 100,
          regularHolidayRate: 1 + formData.regularHolidayRate / 100,
          specialHolidayRate: 1 + formData.specialHolidayRate / 100,
          overtimeRegularRate: 1 + formData.overtimeRegularRate / 100,
          overtimeRestDayRate: 1 + formData.overtimeRestDayRate / 100,
          dailyRateIncludesAllowance: formData.dailyRateIncludesAllowance,
          dailyRateWorkingDaysPerYear: formData.dailyRateWorkingDaysPerYear,
          taxDeductionFrequency: formData.taxDeductionFrequency,
          taxDeductOnPay: formData.taxDeductOnPay,
        },
      });

      await updateOrganization({
        organizationId: currentOrganizationId,
        salaryPaymentFrequency: formData.salaryPaymentFrequency,
        firstPayDate: formData.firstPayDate,
        secondPayDate:
          formData.salaryPaymentFrequency === "bimonthly"
            ? formData.secondPayDate
            : undefined,
      });

      toast({
        title: "Success",
        description: "Payroll settings updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update payroll settings",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h4 className="font-medium">BASE CONFIGS</h4>
          <p className="text-sm text-muted-foreground">
            Enter the <strong>additional</strong> percentage paid on top of
            regular rate for each case (e.g. 10 = 10% additional).
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <LabelWithHelp
                id="nightDiff"
                label="Night Differential (% additional)"
                tooltip="Additional pay for hours 10 PM–6 AM. Example: 10 = 10% on top of regular rate."
              />
              <Input
                id="nightDiff"
                type="number"
                value={formData.nightDiffPercent}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    nightDiffPercent: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <LabelWithHelp
                id="regularHoliday"
                label="Regular Holiday (% additional)"
                tooltip="Additional pay for regular (legal) holiday. Example: 100 = 100% on top of daily rate (double pay)."
              />
              <Input
                id="regularHoliday"
                type="number"
                value={formData.regularHolidayRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    regularHolidayRate: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <LabelWithHelp
                id="specialHoliday"
                label="Special non-working holiday (% additional)"
                tooltip="Additional pay for special non-working holiday. Example: 30 = 30% on top of daily rate."
              />
              <Input
                id="specialHoliday"
                type="number"
                value={formData.specialHolidayRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    specialHolidayRate: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <LabelWithHelp
                id="overtimeRegular"
                label="Overtime Regular (% additional)"
                tooltip="Additional pay for overtime on a regular day. Example: 25 = 25% on top of hourly rate."
              />
              <Input
                id="overtimeRegular"
                type="number"
                value={formData.overtimeRegularRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    overtimeRegularRate: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <LabelWithHelp
                id="overtimeRestDay"
                label="Rest Day Premium (% additional)"
                tooltip="Additional pay for rest day work (first 8h) and the extra for rest day/holiday OT. Example: 30 = 30% on top of base rate."
              />
              <Input
                id="overtimeRestDay"
                type="number"
                value={formData.overtimeRestDayRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    overtimeRestDayRate: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="font-medium">Daily rate (monthly employees)</h4>
          <p className="text-sm text-muted-foreground">
            Daily rate = (basic + allowance if enabled) × (12 ÷ working days per
            year). E.g. 24k + 6k with 261 days → 30,000 × (12/261).
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="dailyRateIncludesAllowance"
                checked={formData.dailyRateIncludesAllowance}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    dailyRateIncludesAllowance: checked === true,
                  })
                }
              />
              <Label
                htmlFor="dailyRateIncludesAllowance"
                className="cursor-pointer font-normal"
              >
                Include allowance in daily rate
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="dailyRateWorkingDaysPerYear"
                className="whitespace-nowrap"
              >
                Working days per year
              </Label>
              <Input
                id="dailyRateWorkingDaysPerYear"
                type="number"
                min={1}
                max={366}
                className="w-20"
                value={formData.dailyRateWorkingDaysPerYear}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    dailyRateWorkingDaysPerYear:
                      parseInt(e.target.value, 10) || 261,
                  })
                }
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="font-medium">Tax deduction</h4>
          <p className="text-sm text-muted-foreground">
            For bimonthly payroll: choose whether to deduct tax once (full on
            one pay) or twice (half on 1st pay, half on 2nd pay). Monthly
            payroll always deducts full tax in one pay.
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="taxDeductionFrequency">
                Tax deduction frequency
              </Label>
              <Select
                value={formData.taxDeductionFrequency || "twice_per_month"}
                onValueChange={(value: "once_per_month" | "twice_per_month") =>
                  setFormData({
                    ...formData,
                    taxDeductionFrequency: value,
                  })
                }
              >
                <SelectTrigger id="taxDeductionFrequency" className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="twice_per_month">
                    Twice per month (half on 1st pay, half on 2nd pay)
                  </SelectItem>
                  <SelectItem value="once_per_month">
                    Once per month (full tax on one pay)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.taxDeductionFrequency === "once_per_month" && (
              <div className="space-y-2">
                <Label htmlFor="taxDeductOnPay">
                  Deduct full tax on which pay?
                </Label>
                <Select
                  value={formData.taxDeductOnPay || "first"}
                  onValueChange={(value: "first" | "second") =>
                    setFormData({
                      ...formData,
                      taxDeductOnPay: value,
                    })
                  }
                >
                  <SelectTrigger id="taxDeductOnPay" className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first">
                      1st pay (e.g. 1st–15th)
                    </SelectItem>
                    <SelectItem value="second">
                      2nd pay (e.g. 16th–30th/31st)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="salaryPaymentFrequency">
              Salary payment frequency
            </Label>
            <Select
              value={formData.salaryPaymentFrequency}
              onValueChange={(value: "monthly" | "bimonthly") =>
                setFormData({
                  ...formData,
                  salaryPaymentFrequency: value,
                  secondPayDate:
                    value === "bimonthly" ? formData.secondPayDate : 30,
                })
              }
            >
              <SelectTrigger id="salaryPaymentFrequency" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Once per month</SelectItem>
                <SelectItem value="bimonthly">
                  Twice per month (e.g. 15th & 30th)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose how often the company runs payroll for monthly employees.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstPayDate">
                {formData.salaryPaymentFrequency === "monthly"
                  ? "Pay date (day of month)"
                  : "First pay date (day of month)"}
              </Label>
              <Input
                id="firstPayDate"
                type="number"
                min="1"
                max="31"
                value={formData.firstPayDate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    firstPayDate: parseInt(e.target.value) || 15,
                  })
                }
              />
            </div>

            {formData.salaryPaymentFrequency === "bimonthly" && (
              <div className="space-y-2">
                <Label htmlFor="secondPayDate">
                  Second pay date (day of month)
                </Label>
                <Input
                  id="secondPayDate"
                  type="number"
                  min="1"
                  max="31"
                  value={formData.secondPayDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      secondPayDate: parseInt(e.target.value) || 30,
                    })
                  }
                />
              </div>
            )}
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
