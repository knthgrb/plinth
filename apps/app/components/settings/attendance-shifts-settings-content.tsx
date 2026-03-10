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
  const [defaultLunchMinutes, setDefaultLunchMinutes] = useState(60);
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
      setDefaultLunchMinutes(att.defaultLunchBreakMinutes ?? 60);
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
          defaultLunchBreakMinutes: defaultLunchMinutes,
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

  const handleSaveShift = async () => {
    if (!currentOrganizationId || !shiftForm.name.trim()) return;
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
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Lunch start (HH:mm)</Label>
              <Input
                type="time"
                value={defaultLunchStart}
                onChange={(e) => setDefaultLunchStart(e.target.value || "12:00")}
              />
            </div>
            <div className="space-y-2">
              <Label>Lunch end (HH:mm)</Label>
              <Input
                type="time"
                value={defaultLunchEnd}
                onChange={(e) => setDefaultLunchEnd(e.target.value || "13:00")}
              />
            </div>
            <div className="space-y-2">
              <Label>Break duration (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={240}
                value={defaultLunchMinutes}
                onChange={(e) => setDefaultLunchMinutes(parseInt(e.target.value, 10) || 60)}
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
                    <TableCell>{s.scheduleIn} – {s.scheduleOut}</TableCell>
                    <TableCell>{s.lunchStart} – {s.lunchEnd}</TableCell>
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
                <Input
                  type="time"
                  value={shiftForm.scheduleIn}
                  onChange={(e) => setShiftForm((f) => ({ ...f, scheduleIn: e.target.value || "09:00" }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Schedule out</Label>
                <Input
                  type="time"
                  value={shiftForm.scheduleOut}
                  onChange={(e) => setShiftForm((f) => ({ ...f, scheduleOut: e.target.value || "18:00" }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Lunch start</Label>
                <Input
                  type="time"
                  value={shiftForm.lunchStart}
                  onChange={(e) => setShiftForm((f) => ({ ...f, lunchStart: e.target.value || "12:00" }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Lunch end</Label>
                <Input
                  type="time"
                  value={shiftForm.lunchEnd}
                  onChange={(e) => setShiftForm((f) => ({ ...f, lunchEnd: e.target.value || "13:00" }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveShift} disabled={savingShift || !shiftForm.name.trim()}>
              {savingShift ? "Saving…" : editingShift ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
