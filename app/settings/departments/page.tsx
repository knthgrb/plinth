"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

export default function DepartmentsSettingsPage() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const updateDepartments = useMutation(
    (api as any).settings.updateDepartments
  );

  const [departments, setDepartments] = useState<string[]>([]);
  const [newDept, setNewDept] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings?.departments) {
      setDepartments(settings.departments);
    }
  }, [settings]);

  const handleAdd = () => {
    const name = newDept.trim();
    if (!name) return;
    if (!departments.includes(name)) {
      setDepartments([...departments, name]);
    }
    setNewDept("");
  };

  const handleRemove = (name: string) => {
    setDepartments(departments.filter((d) => d !== name));
  };

  const handleSave = async () => {
    if (!currentOrganizationId) return;
    setIsSaving(true);
    try {
      await updateDepartments({
        organizationId: currentOrganizationId,
        departments,
      });
      toast({
        title: "Success",
        description: "Departments updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update departments",
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
          <h1 className="text-3xl font-bold text-gray-900">
            Departments Settings
          </h1>
          <p className="text-gray-600 mt-2">Manage organization departments</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Departments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-dept">Add Department</Label>
              <div className="flex gap-2">
                <Input
                  id="new-dept"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  placeholder="e.g., Sales, Marketing"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAdd();
                    }
                  }}
                />
                <Button
                  type="button"
                  onClick={handleAdd}
                  disabled={!newDept.trim()}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="text-center text-gray-500"
                    >
                      No departments configured
                    </TableCell>
                  </TableRow>
                ) : (
                  departments.map((dept) => (
                    <TableRow key={dept}>
                      <TableCell>{dept}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(dept)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {departments.length > 0 && (
              <div className="pt-2">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Departments"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
