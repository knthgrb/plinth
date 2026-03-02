"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronDown, ArrowRight, Plus, Pipette } from "lucide-react";
import { cn } from "@/utils/utils";
import { useSettingsModal } from "@/hooks/settings-modal-context";
import { useOrganization } from "@/hooks/organization-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useToast } from "@/components/ui/use-toast";
import { AdvancedColorPicker } from "@/components/ui/advanced-color-picker";

interface Department {
  name: string;
  color: string;
}

interface DepartmentSelectProps {
  departments: Department[];
  value?: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  onEditDepartments?: () => void;
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

export function DepartmentSelect({
  departments,
  value,
  onValueChange,
  disabled = false,
  onEditDepartments: onEditDepartmentsCallback,
}: DepartmentSelectProps) {
  const { openModal: openSettingsModal } = useSettingsModal();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptColor, setNewDeptColor] = useState(DEFAULT_COLOR);
  const [isCreating, setIsCreating] = useState(false);
  const [showCustomColorPicker, setShowCustomColorPicker] = useState(false);

  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  const updateDepartments = useMutation(
    (api as any).settings.updateDepartments
  );

  // Get current departments from settings (with colors) - prioritize settings over prop
  const currentDepartments = useMemo(() => {
    if (settings?.departments && settings.departments.length > 0) {
      // Handle migration from old format (string[]) to new format (Department[])
      if (typeof settings.departments[0] === "string") {
        // Old format - migrate to new format
        return (settings.departments as string[]).map((name, index) => ({
          name,
          color: PRESET_COLORS[index % PRESET_COLORS.length],
        }));
      }
      return settings.departments as Department[];
    }
    // Fallback to prop if settings not available
    return departments;
  }, [settings, departments]);

  const selectedDepartment = currentDepartments.find((d) => d.name === value);

  const filteredDepartments = useMemo(() => {
    if (!searchQuery.trim()) return currentDepartments;
    const query = searchQuery.toLowerCase();
    return currentDepartments.filter((d) =>
      d.name.toLowerCase().includes(query)
    );
  }, [currentDepartments, searchQuery]);

  const handleSelect = (departmentName: string) => {
    onValueChange(departmentName);
    setOpen(false);
    setSearchQuery("");
    setShowCreateForm(false);
  };

  const handleCreateDepartment = async () => {
    if (!currentOrganizationId || !newDeptName.trim()) return;

    const trimmedName = newDeptName.trim();
    
    // Check if department already exists
    if (currentDepartments.some((d) => d.name.toLowerCase() === trimmedName.toLowerCase())) {
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
        ...currentDepartments,
        { name: trimmedName, color: newDeptColor },
      ];

      await updateDepartments({
        organizationId: currentOrganizationId,
        departments: updatedDepartments,
      });

      // Select the newly created department
      onValueChange(trimmedName);
      
      // Reset form
      setNewDeptName("");
      setNewDeptColor(DEFAULT_COLOR);
      setShowCreateForm(false);
      setSearchQuery("");
      
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

  const handleEditDepartments = () => {
    setOpen(false);
    // Close parent modal if callback is provided
    if (onEditDepartmentsCallback) {
      onEditDepartmentsCallback();
    }
    // Open settings modal with departments section
    openSettingsModal("departments");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 focus-visible:ring-[#695eff] focus-visible:border-[#695eff]"
          disabled={disabled}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selectedDepartment ? (
              <>
                <div
                  className="h-4 w-4 rounded-full shrink-0"
                  style={{ backgroundColor: selectedDepartment.color }}
                />
                <span className="truncate">{selectedDepartment.name}</span>
              </>
            ) : (
              <span className="text-gray-500">Select department...</span>
            )}
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className={cn("p-0", showCustomColorPicker ? "w-[320px]" : "w-[300px]")} 
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => {
          // Prevent focus shift that causes position change
          if (showCreateForm) {
            e.preventDefault();
          }
        }}
      >
        <div className="p-2">
          {!showCreateForm && (
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search Departments"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowCreateForm(false);
                }}
                className="pl-8"
              />
            </div>
          )}
          
          {showCreateForm ? (
            <div className="space-y-3 p-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-5 w-5 rounded-full shrink-0 border-2 border-gray-300"
                    style={{ backgroundColor: newDeptColor }}
                  />
                  <Input
                    placeholder="Department Name"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newDeptName.trim()) {
                        handleCreateDepartment();
                      }
                    }}
                    autoFocus
                    className="flex-1"
                  />
                </div>
                <div className="space-y-2">
                  {showCustomColorPicker ? (
                    <AdvancedColorPicker
                      color={newDeptColor}
                      onColorChange={setNewDeptColor}
                      presetColors={PRESET_COLORS}
                      onBack={() => setShowCustomColorPicker(false)}
                    />
                  ) : (
                    <div className="flex items-center gap-1 flex-wrap">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewDeptColor(color)}
                          className={cn(
                            "h-6 w-6 rounded-full border-2 transition-all",
                            newDeptColor === color
                              ? "border-gray-800 scale-110"
                              : "border-gray-300 hover:border-gray-400"
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowCustomColorPicker(true)}
                        className={cn(
                          "h-6 w-6 rounded-full border-2 transition-all flex items-center justify-center relative overflow-hidden",
                          !PRESET_COLORS.includes(newDeptColor)
                            ? "border-gray-800 scale-110"
                            : "border-gray-300 hover:border-gray-400"
                        )}
                        style={{ backgroundColor: newDeptColor }}
                      >
                        <div className="absolute inset-0 bg-black/20 rounded-full" />
                        <Pipette className="h-3 w-3 text-white relative z-10 drop-shadow-sm" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewDeptName("");
                    setNewDeptColor(DEFAULT_COLOR);
                    setShowCustomColorPicker(false);
                  }}
                  className="flex-1"
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreateDepartment}
                  disabled={!newDeptName.trim() || isCreating}
                  className="flex-1"
                >
                  {isCreating ? "Creating..." : "Create"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="max-h-[200px] overflow-y-auto">
                {filteredDepartments.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">
                    No departments found
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredDepartments.map((dept) => (
                      <button
                        key={dept.name}
                        type="button"
                        onClick={() => handleSelect(dept.name)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-gray-100 transition-colors text-left",
                          value === dept.name && "bg-gray-100"
                        )}
                      >
                        <div
                          className="h-4 w-4 rounded-full shrink-0"
                          style={{ backgroundColor: dept.color }}
                        />
                        <span className="flex-1">{dept.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-2 pt-2 border-t space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(true);
                    setSearchQuery("");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-md transition-colors font-medium"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Department</span>
                </button>
                <button
                  type="button"
                  onClick={handleEditDepartments}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
                >
                  <span>Edit Departments</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
