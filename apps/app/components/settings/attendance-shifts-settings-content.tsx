"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { formatTime12Hour } from "@/utils/attendance-calculations";
import { TimePicker } from "@/components/ui/time-picker";

export function AttendanceShiftsSettingsContent() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const shifts = useQuery(
    (api as any).shifts.listShifts,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const updateAttendanceSettings = useMutation(
    (api as any).settings.updateAttendanceSettings,
  );
  const createShift = useMutation((api as any).shifts.createShift);
  const updateShift = useMutation((api as any).shifts.updateShift);
  const deleteShift = useMutation((api as any).shifts.deleteShift);

  const [defaultLunchStart, setDefaultLunchStart] = useState("12:00");
  const [defaultLunchEnd, setDefaultLunchEnd] = useState("13:00");
  const [savingLunch, setSavingLunch] = useState(false);

  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<{
    _id: Id<"shifts">;
    name: string;
    scheduleIn: string;
    scheduleOut: string;
    lunchStart: string;
    lunchEnd: string;
  } | null>(null);
  const [shiftForm, setShiftForm] = useState({
    name: "",
    scheduleIn: "09:00",
    scheduleOut: "18:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
  });
  const [savingShift, setSavingShift] = useState(false);
  const [deletingShiftId, setDeletingShiftId] = useState<Id<"shifts"> | null>(null);

  useEffect(() => {
    const att = settings?.attendanceSettings;
    if (att) {
      setDefaultLunchStart(att.defaultLunchStart ?? "12:00");
      setDefaultLunchEnd(att.defaultLunchEnd ?? "13:00");
    }
  }, [settings?.attendanceSettings]);

  const handleSaveDefaultLunch = async () => {
    if (!currentOrganizationId) return;
    setSavingLunch(true);
    try {
      await updateAttendanceSettings({
        organizationId: currentOrganizationId,
        attendanceSettings: {
          defaultLunchStart,
          defaultLunchEnd,
        },
      });
      toast({ title: "Saved", description: "Default lunch settings updated." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "Failed to save.", variant: "destructive" });
    } finally {
      setSavingLunch(false);
    }
  };

  const openAddShift = () => {
    setEditingShift(null);
    setShiftForm({
      name: "",
      scheduleIn: "09:00",
      scheduleOut: "18:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
    });
    setShiftDialogOpen(true);
  };

  const openEditShift = (s: any) => {
    setEditingShift(s);
    setShiftForm({
      name: s.name,
      scheduleIn: s.scheduleIn ?? "09:00",
      scheduleOut: s.scheduleOut ?? "18:00",
      lunchStart: s.lunchStart ?? "12:00",
      lunchEnd: s.lunchEnd ?? "13:00",
    });
    setShiftDialogOpen(true);
  };

  /** Parse "HH:mm" to minutes since midnight (0–1439). */
  const timeToMinutes = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  /**
   * Validate that lunch period falls within schedule in/out.
   * Same-day: scheduleIn <= lunchStart < lunchEnd <= scheduleOut.
   * Overnight (scheduleOut < scheduleIn, e.g. 18:00–03:00): lunch can be in [scheduleIn, 24:00), or [0, scheduleOut], or cross midnight (e.g. 23:00–00:00).
   */
  const getShiftLunchValidationError = (): string | null => {
    const inMin = timeToMinutes(shiftForm.scheduleIn);
    const outMin = timeToMinutes(shiftForm.scheduleOut);
    const startMin = timeToMinutes(shiftForm.lunchStart);
    const endMin = timeToMinutes(shiftForm.lunchEnd);
    const isOvernight = outMin <= inMin;

    // "Lunch start before lunch end": for same-day we require start < end; for overnight, lunch can cross midnight (e.g. 23:00–00:00)
    if (startMin >= endMin) {
      if (!isOvernight) {
        return "Lunch start must be before lunch end.";
      }
      // Overnight: 00:00 is next day, so 23:00–00:00 is valid. Reject only if "end" would be before "start" even on next day (impossible with 0–1439).
      // So for overnight we allow startMin >= endMin when endMin is small (midnight) and startMin is large (evening).
    }

    if (!isOvernight) {
      // Same-day shift
      if (startMin < inMin) {
        return "Lunch start must not be before schedule in.";
      }
      if (endMin > outMin) {
        return "Lunch end must not be after schedule out.";
      }
    } else {
      // Overnight shift: lunch either (a) entirely in evening [inMin, 24:00), (b) entirely in morning [0, outMin], or (c) crosses midnight [start in evening, end in morning]
      const midnight = 24 * 60;
      const lunchCrossesMidnight = endMin < startMin;
      if (lunchCrossesMidnight) {
        // e.g. 23:00–00:00: start must be in evening part, end must be in morning part
        if (startMin < inMin) {
          return "Lunch start must not be before schedule in.";
        }
        if (endMin > outMin) {
          return "Lunch end must not be after schedule out.";
        }
      } else {
        const inEvening = startMin >= inMin && endMin <= midnight;
        const inMorning = startMin >= 0 && endMin <= outMin;
        if (!inEvening && !inMorning) {
          return "Lunch must fall between schedule in and schedule out (within the shift).";
        }
      }
    }
    return null;
  };

  const shiftLunchError = getShiftLunchValidationError();

  const handleSaveShift = async () => {
    if (!currentOrganizationId || !shiftForm.name.trim()) return;
    if (shiftLunchError) {
      toast({ title: "Invalid lunch period", description: shiftLunchError, variant: "destructive" });
      return;
    }
    setSavingShift(true);
    try {
      if (editingShift) {
        await updateShift({
          shiftId: editingShift._id,
          name: shiftForm.name.trim(),
          scheduleIn: shiftForm.scheduleIn,
          scheduleOut: shiftForm.scheduleOut,
          lunchStart: shiftForm.lunchStart,
          lunchEnd: shiftForm.lunchEnd,
        });
        toast({ title: "Updated", description: "Shift updated." });
      } else {
        await createShift({
          organizationId: currentOrganizationId,
          name: shiftForm.name.trim(),
          scheduleIn: shiftForm.scheduleIn,
          scheduleOut: shiftForm.scheduleOut,
          lunchStart: shiftForm.lunchStart,
          lunchEnd: shiftForm.lunchEnd,
        });
        toast({ title: "Created", description: "Shift added." });
      }
      setShiftDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "Failed to save shift.", variant: "destructive" });
    } finally {
      setSavingShift(false);
    }
  };

  const handleDeleteShift = async (shiftId: Id<"shifts">) => {
    setDeletingShiftId(shiftId);
    try {
      await deleteShift({ shiftId });
      toast({ title: "Deleted", description: "Shift removed." });
    } catch (e: any) {
      toast({ title: "Error", description: e?.message ?? "Failed to delete.", variant: "destructive" });
    } finally {
      setDeletingShiftId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Default lunch break</CardTitle>
          <p className="text-sm text-muted-foreground">
            Used for employees without a shift. Also used when computing paid hours and late/undertime if no shift is assigned.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Break duration is automatic: end time − start time.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Lunch start</Label>
              <TimePicker
                value={defaultLunchStart}
                onValueChange={(v) => setDefaultLunchStart(v || "12:00")}
                label=""
                showLabel={false}
              />
            </div>
            <div className="space-y-2">
              <Label>Lunch end</Label>
              <TimePicker
                value={defaultLunchEnd}
                onValueChange={(v) => setDefaultLunchEnd(v || "13:00")}
                label=""
                showLabel={false}
              />
            </div>
          </div>
          <Button onClick={handleSaveDefaultLunch} disabled={savingLunch}>
            {savingLunch ? "Saving…" : "Save default lunch"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
          <p className="text-sm text-muted-foreground">
            Define shifts with schedule and lunch window. Assign a shift to an employee so late/undertime and paid hours use that shift&apos;s lunch. Employees without a shift use the default lunch above.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={openAddShift}>
              <Plus className="h-4 w-4 mr-2" />
              Add shift
            </Button>
          </div>
          {shifts && shifts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Lunch</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s: any) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {formatTime12Hour(s.scheduleIn)} – {formatTime12Hour(s.scheduleOut)}
                    </TableCell>
                    <TableCell>
                      {formatTime12Hour(s.lunchStart)} – {formatTime12Hour(s.lunchEnd)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditShift(s)}
                          aria-label="Edit shift"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteShift(s._id)}
                          disabled={deletingShiftId === s._id}
                          aria-label="Delete shift"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No shifts yet. Add one to use shift-specific lunch for employees.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingShift ? "Edit shift" : "Add shift"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Name (e.g. Morning, UK, Night)</Label>
              <Input
                value={shiftForm.name}
                onChange={(e) => setShiftForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Morning"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Schedule in</Label>
                <TimePicker
                  value={shiftForm.scheduleIn}
                  onValueChange={(v) => setShiftForm((f) => ({ ...f, scheduleIn: v || "09:00" }))}
                  label=""
                  showLabel={false}
                />
              </div>
              <div className="space-y-2">
                <Label>Schedule out</Label>
                <TimePicker
                  value={shiftForm.scheduleOut}
                  onValueChange={(v) => setShiftForm((f) => ({ ...f, scheduleOut: v || "18:00" }))}
                  label=""
                  showLabel={false}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Lunch start</Label>
                <TimePicker
                  value={shiftForm.lunchStart}
                  onValueChange={(v) => setShiftForm((f) => ({ ...f, lunchStart: v || "12:00" }))}
                  label=""
                  showLabel={false}
                  className={shiftLunchError ? "[&_button]:border-red-500" : undefined}
                />
              </div>
              <div className="space-y-2">
                <Label>Lunch end</Label>
                <TimePicker
                  value={shiftForm.lunchEnd}
                  onValueChange={(v) => setShiftForm((f) => ({ ...f, lunchEnd: v || "13:00" }))}
                  label=""
                  showLabel={false}
                  className={shiftLunchError ? "[&_button]:border-red-500" : undefined}
                />
              </div>
            </div>
            {shiftLunchError && (
              <p className="text-sm text-red-600">{shiftLunchError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveShift} disabled={savingShift || !shiftForm.name.trim() || !!shiftLunchError}>
              {savingShift ? "Saving…" : editingShift ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
