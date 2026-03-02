"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, Trash2, Pencil, X, Pipette } from "lucide-react";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";
import { AdvancedColorPicker } from "@/components/ui/advanced-color-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/utils";

interface Department {
  name: string;
  color: string;
}

const DEFAULT_COLOR = "#3B82F6"; // blue
const PRESET_COLORS = [
  "#9CA3AF", // gray
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#3B82F6", // blue
  "#A855F7", // purple
  "#EC4899", // pink
];

export function DepartmentsSettingsContent() {
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const updateDepartments = useMutation(
    (api as any).settings.updateDepartments
  );

  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDept, setNewDept] = useState("");
  const [newDeptColor, setNewDeptColor] = useState(DEFAULT_COLOR);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editDeptName, setEditDeptName] = useState("");
  const [editDeptColor, setEditDeptColor] = useState("");
  const [showEditAdvancedColorPicker, setShowEditAdvancedColorPicker] = useState(false);
  const [showAdvancedColorPicker, setShowAdvancedColorPicker] = useState(false);

  useEffect(() => {
    if (settings?.departments) {
      // Handle migration from old format (string[]) to new format (Department[])
      if (settings.departments.length > 0) {
        if (typeof settings.departments[0] === "string") {
          // Old format - migrate to new format
          const migrated = (settings.departments as string[]).map((name, index) => ({
            name,
            color: PRESET_COLORS[index % PRESET_COLORS.length],
          }));
          setDepartments(migrated);
        } else {
          // New format
          setDepartments(settings.departments as Department[]);
        }
      } else {
        setDepartments([]);
      }
    }
  }, [settings]);

  // Filter departments based on search
  const filteredDepartments = useMemo(() => {
    if (!searchQuery.trim()) return departments;
    const query = searchQuery.toLowerCase();
    return departments.filter((d) =>
      d.name.toLowerCase().includes(query)
    );
  }, [departments, searchQuery]);

  const handleCreateDepartment = async () => {
    if (!currentOrganizationId || !newDept.trim()) return;

    const trimmedName = newDept.trim();
    
    // Check if department already exists
    if (departments.some((d) => d.name.toLowerCase() === trimmedName.toLowerCase())) {
      toast({
        title: "Error",
        description: "This department already exists",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      const updatedDepartments = [
        ...departments,
        { name: trimmedName, color: newDeptColor },
      ];

      await updateDepartments({
        organizationId: currentOrganizationId,
        departments: updatedDepartments,
      });

      // Update local state
      setDepartments(updatedDepartments);

      // Reset form
      setNewDept("");
      setNewDeptColor(DEFAULT_COLOR);
      setShowCreateForm(false);
      setShowAdvancedColorPicker(false);
      
      toast({
        title: "Success",
        description: "Department created successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create department",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelCreate = () => {
    setNewDept("");
    setNewDeptColor(DEFAULT_COLOR);
    setShowCreateForm(false);
    setShowAdvancedColorPicker(false);
  };

  const handleEditStart = (dept: Department) => {
    setEditingDept(dept);
    setEditDeptName(dept.name);
    setEditDeptColor(dept.color);
    setShowEditAdvancedColorPicker(false);
  };

  const handleEditSave = async () => {
    if (!editingDept || !editDeptName.trim() || !currentOrganizationId) return;
    
    setIsSaving(true);
    try {
      const updatedDepartments = departments.map((d) =>
        d.name === editingDept.name
          ? { name: editDeptName.trim(), color: editDeptColor }
          : d
      );
      
      await updateDepartments({
        organizationId: currentOrganizationId,
        departments: updatedDepartments,
      });
      
      // Update local state
      setDepartments(updatedDepartments);
      
      setEditingDept(null);
      setEditDeptName("");
      setEditDeptColor("");
      setShowEditAdvancedColorPicker(false);
      
      toast({
        title: "Success",
        description: "Department updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update department",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditCancel = () => {
    setEditingDept(null);
    setEditDeptName("");
    setEditDeptColor("");
    setShowEditAdvancedColorPicker(false);
  };

  const handleRemove = async (name: string) => {
    if (!currentOrganizationId) return;
    
    const updatedDepartments = departments.filter((d) => d.name !== name);
    setIsSaving(true);
    try {
      await updateDepartments({
        organizationId: currentOrganizationId,
        departments: updatedDepartments,
      });
      
      // Update local state
      setDepartments(updatedDepartments);
      
      toast({
        title: "Success",
        description: "Department removed successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove department",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Create Button */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search department"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setShowCreateForm(true);
            setSearchQuery("");
          }}
          disabled={showCreateForm}
        >
          Create Department
        </Button>
      </div>

      {/* Create Department Form */}
      {showCreateForm && (
        <div className="space-y-3">
          {showAdvancedColorPicker ? (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <AdvancedColorPicker
                color={newDeptColor}
                onColorChange={setNewDeptColor}
                presetColors={PRESET_COLORS}
                onBack={() => setShowAdvancedColorPicker(false)}
              />
            </div>
          ) : (
            <>
              {/* Main Form Row */}
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-3">
                  {/* Color Circle in Container */}
                  <div
                    className={cn(
                      "h-10 w-10 rounded-md border border-gray-300 shrink-0 flex items-center justify-center transition-all",
                      "hover:border-transparent"
                    )}
                  >
                    <div
                      className="h-6 w-6 rounded-full"
                      style={{ backgroundColor: newDeptColor }}
                    />
                  </div>
                  
                  {/* Department Name Input */}
                  <Input
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    placeholder="Department name"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newDept.trim()) {
                        handleCreateDepartment();
                      }
                    }}
                  />
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCancelCreate}
                      disabled={isCreating}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={handleCreateDepartment}
                      disabled={!newDept.trim() || isCreating}
                    >
                      {isCreating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              </div>
              
              {/* Default Colors Palette */}
              <div className="p-3 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((presetColor) => (
                    <button
                      key={presetColor}
                      type="button"
                      onClick={() => setNewDeptColor(presetColor)}
                      className={cn(
                        "h-8 w-8 rounded-full border-2 transition-all",
                        newDeptColor === presetColor
                          ? "border-gray-900 scale-110"
                          : "border-gray-300 hover:border-gray-400"
                      )}
                      style={{ backgroundColor: presetColor }}
                    />
                  ))}
                  <div className="h-8 w-px bg-gray-300 mx-1" />
                  <button
                    type="button"
                    onClick={() => setShowAdvancedColorPicker(true)}
                    className="h-8 w-8 rounded-md border-2 border-gray-300 hover:border-gray-400 flex items-center justify-center transition-all"
                  >
                    <Pipette className="h-4 w-4 text-gray-600" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Departments List */}
      <div className="space-y-2">
        {filteredDepartments.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {searchQuery ? "No departments found" : "No departments configured"}
          </div>
        ) : (
          filteredDepartments.map((dept) => (
            <div
              key={dept.name}
              className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {/* Color Circle in Container */}
                <div
                  className={cn(
                    "h-10 w-10 rounded-md border border-gray-300 shrink-0 flex items-center justify-center transition-all",
                    "hover:border-transparent"
                  )}
                >
                  <div
                    className="h-6 w-6 rounded-full"
                    style={{ backgroundColor: dept.color }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-900">
                  {dept.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditStart(dept)}
                  className="h-8 w-8 p-0"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(dept.name)}
                  className="h-8 w-8 p-0"
                  disabled={isSaving}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit Department Dialog */}
      <Dialog open={!!editingDept} onOpenChange={handleEditCancel}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {showEditAdvancedColorPicker ? "Edit Color" : "Edit Department"}
            </DialogTitle>
          </DialogHeader>
          {showEditAdvancedColorPicker ? (
            <AdvancedColorPicker
              color={editDeptColor}
              onColorChange={setEditDeptColor}
              presetColors={PRESET_COLORS}
              onBack={() => setShowEditAdvancedColorPicker(false)}
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Department Name</Label>
                <div className="flex items-center gap-2">
                  {/* Color Circle in Container */}
                  <div
                    className={cn(
                      "h-10 w-10 rounded-md border border-gray-300 shrink-0 flex items-center justify-center transition-all",
                      "hover:border-transparent"
                    )}
                  >
                    <div
                      className="h-6 w-6 rounded-full"
                      style={{ backgroundColor: editDeptColor }}
                    />
                  </div>
                  <Input
                    value={editDeptName}
                    onChange={(e) => {
                      setEditDeptName(e.target.value);
                    }}
                    placeholder="Department name"
                    className="flex-1"
                  />
                </div>
              </div>
              
              {/* Default Colors Palette */}
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-2">
                    {PRESET_COLORS.map((presetColor) => (
                      <button
                        key={presetColor}
                        type="button"
                        onClick={() => setEditDeptColor(presetColor)}
                        className={cn(
                          "h-8 w-8 rounded-full border-2 transition-all",
                          editDeptColor === presetColor
                            ? "border-gray-900 scale-110"
                            : "border-gray-300 hover:border-gray-400"
                        )}
                        style={{ backgroundColor: presetColor }}
                      />
                    ))}
                    <div className="h-8 w-px bg-gray-300 mx-1" />
                    <button
                      type="button"
                      onClick={() => setShowEditAdvancedColorPicker(true)}
                      className="h-8 w-8 rounded-md border-2 border-gray-300 hover:border-gray-400 flex items-center justify-center transition-all"
                    >
                      <Pipette className="h-4 w-4 text-gray-600" />
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleEditCancel}
                  className="flex-1"
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleEditSave}
                  className="flex-1"
                  disabled={!editDeptName.trim() || isSaving}
                >
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
