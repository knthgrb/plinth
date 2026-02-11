"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
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
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const organization = useQuery(
    (api as any).organizations.getOrganization,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const updatePayrollSettings = useMutation(
    (api as any).settings.updatePayrollSettings
  );
  const updateOrganization = useMutation(
    (api as any).organizations.updateOrganization
  );

  const [formData, setFormData] = useState({
    nightDiffPercent: 10,
    regularHolidayRate: 100,
    specialHolidayRate: 30,
    overtimeRegularRate: 125,
    overtimeRestDayRate: 169,
    regularHolidayOtRate: 200,
    specialHolidayOtRate: 169,
    dailyRateIncludesAllowance: false,
    dailyRateWorkingDaysPerYear: 261,
    firstPayDate: 15,
    secondPayDate: 30,
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings?.payrollSettings) {
      setFormData({
        nightDiffPercent:
          (settings.payrollSettings.nightDiffPercent || 0.1) * 100,
        regularHolidayRate:
          (settings.payrollSettings.regularHolidayRate || 1.0) * 100,
        specialHolidayRate:
          (settings.payrollSettings.specialHolidayRate || 0.3) * 100,
        overtimeRegularRate:
          (settings.payrollSettings.overtimeRegularRate || 1.25) * 100,
        overtimeRestDayRate:
          (settings.payrollSettings.overtimeRestDayRate || 1.69) * 100,
        regularHolidayOtRate:
          (settings.payrollSettings.regularHolidayOtRate ?? 2.0) * 100,
        specialHolidayOtRate:
          (settings.payrollSettings.specialHolidayOtRate ?? 1.69) * 100,
        dailyRateIncludesAllowance:
          settings.payrollSettings.dailyRateIncludesAllowance ?? false,
        dailyRateWorkingDaysPerYear:
          settings.payrollSettings.dailyRateWorkingDaysPerYear ?? 261,
        firstPayDate: organization?.firstPayDate || 15,
        secondPayDate: organization?.secondPayDate || 30,
      });
    } else {
      setFormData((prev) => ({
        ...prev,
        firstPayDate: organization?.firstPayDate || 15,
        secondPayDate: organization?.secondPayDate || 30,
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
          nightDiffPercent: formData.nightDiffPercent / 100,
          regularHolidayRate: formData.regularHolidayRate / 100,
          specialHolidayRate: formData.specialHolidayRate / 100,
          overtimeRegularRate: formData.overtimeRegularRate / 100,
          overtimeRestDayRate: formData.overtimeRestDayRate / 100,
          regularHolidayOtRate: formData.regularHolidayOtRate / 100,
          specialHolidayOtRate: formData.specialHolidayOtRate / 100,
          dailyRateIncludesAllowance: formData.dailyRateIncludesAllowance,
          dailyRateWorkingDaysPerYear: formData.dailyRateWorkingDaysPerYear,
        },
      });

      await updateOrganization({
        organizationId: currentOrganizationId,
        firstPayDate: formData.firstPayDate,
        secondPayDate: formData.secondPayDate,
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
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <LabelWithHelp
              id="nightDiff"
              label="Night Differential (%)"
              tooltip="Additional pay per hour for hours worked from 10 PM onwards. Pay = (night diff hours) × hourly rate × (this %). E.g. 10% = add 10% of hourly rate for each such hour."
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
              label="Regular Holiday Rate (%)"
              tooltip="Additional day premium: add this % of daily pay when the employee works on a regular holiday. E.g. 100% = one full daily rate extra for that day."
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
              label="Special Holiday Rate (%)"
              tooltip="Additional day premium: add this % of daily pay when the employee works on a special holiday. E.g. 30% = 30% of daily rate extra for that day."
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
              label="Overtime Regular Rate (%)"
              tooltip="Multiplied by OT hours: OT pay = hourly rate × (this % ÷ 100) × OT hours. E.g. 125% = 1.25× hourly rate per OT hour (25% additional per hour on top of regular)."
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
              label="Overtime Rest Day Rate (%)"
              tooltip="Multiplied by OT hours on a rest day: OT pay = hourly rate × (this % ÷ 100) × OT hours. E.g. 169% = 1.69× hourly rate per OT hour."
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

          <div className="space-y-2">
            <LabelWithHelp
              id="regularHolidayOt"
              label="Regular Holiday OT Rate (%)"
              tooltip="Multiplied by OT hours on a regular holiday: OT pay = hourly rate × (this % ÷ 100) × OT hours. E.g. 200% = 2× hourly rate per OT hour."
            />
            <Input
              id="regularHolidayOt"
              type="number"
              value={formData.regularHolidayOtRate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  regularHolidayOtRate: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>

          <div className="space-y-2">
            <LabelWithHelp
              id="specialHolidayOt"
              label="Special Holiday OT Rate (%)"
              tooltip="Multiplied by OT hours on a special holiday: OT pay = hourly rate × (this % ÷ 100) × OT hours. E.g. 169% = 1.69× hourly rate per OT hour."
            />
            <Input
              id="specialHolidayOt"
              type="number"
              value={formData.specialHolidayOtRate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  specialHolidayOtRate: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="font-medium">Daily rate (monthly employees)</h4>
          <p className="text-sm text-muted-foreground">
            Daily rate = (basic + allowance if enabled) × (12 ÷ working days per year). E.g. 24k + 6k with 261 days → 30,000 × (12/261).
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
              <Label htmlFor="dailyRateWorkingDaysPerYear" className="whitespace-nowrap">
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

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstPayDate">First Pay Date (Day of Month)</Label>
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

          <div className="space-y-2">
            <Label htmlFor="secondPayDate">Second Pay Date (Day of Month)</Label>
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
        </div>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
