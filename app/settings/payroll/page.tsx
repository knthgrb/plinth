"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

export default function PayrollSettingsPage() {
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
    <MainLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Payroll Settings</h1>
          <p className="text-gray-600 mt-2">
            Configure payroll calculation rates and pay dates
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payroll Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nightDiffPercent">
                    Night Differential (% of salary)
                  </Label>
                  <Input
                    id="nightDiffPercent"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={formData.nightDiffPercent}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        nightDiffPercent: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-gray-500">
                    Default: 10% (PH Labor Code)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regularHolidayRate">
                    Regular Holiday Rate (% additional)
                  </Label>
                  <Input
                    id="regularHolidayRate"
                    type="number"
                    step="1"
                    min="0"
                    max="200"
                    value={formData.regularHolidayRate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        regularHolidayRate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-gray-500">
                    Default: 100% (200% total - PH Labor Code)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialHolidayRate">
                    Special Holiday Rate (% additional)
                  </Label>
                  <Input
                    id="specialHolidayRate"
                    type="number"
                    step="1"
                    min="0"
                    max="200"
                    value={formData.specialHolidayRate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        specialHolidayRate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-gray-500">
                    Default: 30% (130% total - PH Labor Code)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="overtimeRegularRate">
                    Overtime Regular Day Rate (%)
                  </Label>
                  <Input
                    id="overtimeRegularRate"
                    type="number"
                    step="1"
                    min="100"
                    max="300"
                    value={formData.overtimeRegularRate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        overtimeRegularRate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-gray-500">
                    Default: 125% (PH Labor Code)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="overtimeRestDayRate">
                    Overtime Rest Day Rate (%)
                  </Label>
                  <Input
                    id="overtimeRestDayRate"
                    type="number"
                    step="1"
                    min="100"
                    max="300"
                    value={formData.overtimeRestDayRate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        overtimeRestDayRate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-gray-500">
                    Default: 169% (PH Labor Code)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="firstPayDate">
                    First Pay Date (Day of Month)
                  </Label>
                  <Input
                    id="firstPayDate"
                    type="number"
                    step="1"
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
                  <p className="text-xs text-gray-500">
                    Default: 15th of the month
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secondPayDate">
                    Second Pay Date (Day of Month)
                  </Label>
                  <Input
                    id="secondPayDate"
                    type="number"
                    step="1"
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
                  <p className="text-xs text-gray-500">
                    Default: 30th of the month
                  </p>
                </div>
              </div>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
