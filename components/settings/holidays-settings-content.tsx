"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

export function HolidaysSettingsContent() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const holidays = useQuery(
    (api as any).holidays.getHolidays,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const createHoliday = useMutation((api as any).holidays.createHoliday);
  const updateHoliday = useMutation((api as any).holidays.updateHoliday);
  const deleteHoliday = useMutation((api as any).holidays.deleteHoliday);
  const bulkCreateHolidays = useMutation(
    (api as any).holidays.bulkCreateHolidays
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    date: "",
    type: "regular" as "regular" | "special" | "special_working",
    isRecurring: false,
  });
  const [bulkText, setBulkText] = useState("");
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  const handleAdd = () => {
    setEditingHoliday(null);
    setFormData({
      name: "",
      date: "",
      type: "regular",
    isRecurring: false,
    });
    setIsDialogOpen(true);
  };

  const handleEdit = (holiday: any) => {
    setEditingHoliday(holiday);
    const date = new Date(holiday.date);
    setFormData({
      name: holiday.name,
      date: date.toISOString().split("T")[0],
      type: holiday.type,
      isRecurring: holiday.isRecurring,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!currentOrganizationId || !formData.name || !formData.date) return;

    try {
      const date = new Date(formData.date);
      const dateTimestamp = date.getTime();

      if (editingHoliday) {
        await updateHoliday({
          holidayId: editingHoliday._id,
          name: formData.name,
          date: dateTimestamp,
          type: formData.type,
          isRecurring: formData.isRecurring,
        });
        toast({
          title: "Success",
          description: "Holiday updated successfully",
        });
      } else {
        await createHoliday({
          organizationId: currentOrganizationId,
          name: formData.name,
          date: dateTimestamp,
          type: formData.type,
          isRecurring: formData.isRecurring,
        });
        toast({
          title: "Success",
          description: "Holiday created successfully",
        });
      }
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save holiday",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (holidayId: string) => {
    if (!confirm("Are you sure you want to delete this holiday?")) return;
    try {
      await deleteHoliday({ holidayId });
      toast({
        title: "Success",
        description: "Holiday deleted successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete holiday",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Holidays Management</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsBulkDialogOpen(true)}
              >
                <Upload className="h-4 w-4 mr-2" />
                Bulk Import
              </Button>
              <Button onClick={handleAdd}>
                <Plus className="h-4 w-4 mr-2" />
                Add Holiday
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Recurring</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!holidays ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : holidays.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-gray-500"
                  >
                    No holidays configured
                  </TableCell>
                </TableRow>
              ) : (
                holidays.map((holiday: any) => (
                  <TableRow key={holiday._id}>
                    <TableCell>{holiday.name}</TableCell>
                    <TableCell>
                      {new Date(holiday.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          holiday.type === "regular"
                            ? "bg-blue-100 text-blue-800"
                            : holiday.type === "special"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {holiday.type === "regular"
                          ? "Regular holiday"
                          : holiday.type === "special"
                            ? "Special non-working holiday"
                            : "Special working holiday"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {holiday.isRecurring ? "Yes" : "No"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(holiday)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(holiday._id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingHoliday ? "Edit" : "Add"} Holiday
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="e.g., New Year's Day"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <DatePicker
                    value={formData.date}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, date: value }))
                    }
                    placeholder="Select holiday date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(
                      value: "regular" | "special" | "special_working",
                    ) =>
                      setFormData((prev) => ({
                        ...prev,
                        type: value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select holiday type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">Regular holiday</SelectItem>
                      <SelectItem value="special">
                        Special non-working holiday
                      </SelectItem>
                      <SelectItem value="special_working">
                        Special working holiday
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isRecurring"
                    checked={formData.isRecurring}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        isRecurring: checked as boolean,
                      })
                    }
                  />
                  <Label htmlFor="isRecurring">Recurring (every year)</Label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Bulk Import Dialog */}
          <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Bulk Import Holidays</DialogTitle>
                <DialogDescription>
                  Import multiple holidays at once. Format: One holiday per
                  line.
                  <br />
                  Format: <code>Name,Date,Type,Recurring</code>
                  <br />
                  Example: <code>New Year's Day,2025-01-01,regular,true</code>
                  <br />
                  <br />
                  Date format: YYYY-MM-DD
                  <br />
                  Type: regular, special, or special_working
                  <br />
                  Recurring: true or false
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Holidays (CSV format)</Label>
                  <Textarea
                    value={bulkText}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setBulkText(e.target.value)
                    }
                    placeholder={`New Year's Day,2025-01-01,regular,true
Labor Day,2025-05-01,regular,true
Independence Day,2025-06-12,regular,true
All Saints' Day,2025-11-01,special,false`}
                    rows={10}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsBulkDialogOpen(false);
                    setBulkText("");
                  }}
                  disabled={isProcessingBulk}
                >
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    if (!currentOrganizationId || !bulkText.trim()) return;

                    setIsProcessingBulk(true);
                    try {
                      const lines = bulkText
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0);

                      const holidays = lines
                        .map((line) => {
                          const parts = line.split(",").map((p) => p.trim());
                          if (parts.length < 4) return null;

                          const [name, dateStr, type, recurringStr] = parts;
                          const date = new Date(dateStr);
                          if (isNaN(date.getTime())) return null;

                          const isRecurring =
                            recurringStr.toLowerCase() === "true";
                          const holidayType =
                            type.toLowerCase() === "special_working"
                              ? "special_working"
                              : type.toLowerCase() === "special"
                                ? "special"
                                : "regular";

                          return {
                            name,
                            date: date.getTime(),
                            type: holidayType,
                            isRecurring,
                            year: isRecurring
                              ? undefined
                              : date.getFullYear(),
                          };
                        })
                        .filter((h) => h !== null) as Array<{
                        name: string;
                        date: number;
                        type: "regular" | "special" | "special_working";
                        isRecurring: boolean;
                        year?: number;
                      }>;

                      if (holidays.length === 0) {
                        toast({
                          title: "Error",
                          description: "No valid holidays found in the input",
                          variant: "destructive",
                        });
                        return;
                      }

                      const result = await bulkCreateHolidays({
                        organizationId: currentOrganizationId as any,
                        holidays,
                      });

                      toast({
                        title: "Success",
                        description: `Created ${result.created} holiday(s), skipped ${result.skipped} duplicate(s)`,
                      });

                      setIsBulkDialogOpen(false);
                      setBulkText("");
                    } catch (error: any) {
                      toast({
                        title: "Error",
                        description:
                          error.message || "Failed to import holidays",
                        variant: "destructive",
                      });
                    } finally {
                      setIsProcessingBulk(false);
                    }
                  }}
                  disabled={isProcessingBulk}
                >
                  {isProcessingBulk ? "Importing..." : "Import Holidays"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </>
  );
}
