"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Trash2 } from "lucide-react";
import { format } from "date-fns";
import {
  updateRequirementStatus,
  updateRequirementFile,
  removeRequirement,
  setEmployeeRequirementsComplete,
} from "@/actions/employees";
import { getFileUrl as getFileUrlAction } from "@/actions/files";
import { useToast } from "@/components/ui/use-toast";
import { AddRequirementDialog } from "./add-requirement-dialog";
import { FileText } from "lucide-react";
import { getStatusBadgeClass, getStatusBadgeStyle } from "@/utils/colors";

interface FileDisplayProps {
  storageId: string;
  requirementType: string;
  onPreview: () => void;
  fileMetadataCache: React.MutableRefObject<{
    [key: string]: {
      url: string;
      type: "image" | "pdf" | "other";
      filename: string;
    };
  }>;
  getFileMetadata: (
    storageId: string,
    requirementType: string
  ) => Promise<{
    url: string;
    type: "image" | "pdf" | "other";
    filename: string;
  }>;
}

function FileDisplay({
  storageId,
  requirementType,
  onPreview,
  fileMetadataCache,
  getFileMetadata,
}: FileDisplayProps) {
  const [filename, setFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (fileMetadataCache.current[storageId]) {
      setFilename(fileMetadataCache.current[storageId].filename);
      setLoading(false);
      return;
    }

    getFileMetadata(storageId, requirementType)
      .then((metadata) => {
        setFilename(metadata.filename);
        setLoading(false);
      })
      .catch(() => {
        setFilename(`${requirementType}_file`);
        setLoading(false);
      });
  }, [storageId, requirementType, fileMetadataCache, getFileMetadata]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 mb-2 animate-pulse">
        <div className="h-3 w-3 rounded bg-gray-200" />
        <div className="h-4 w-28 rounded bg-gray-200" />
      </div>
    );
  }

  return (
    <button
      onClick={onPreview}
      className="text-sm text-blue-600 hover:text-blue-800 hover:underline mb-2 text-left"
    >
      <FileText className="h-3 w-3 inline mr-1" />
      {filename || `${requirementType}_file`}
    </button>
  );
}

interface EmployeeRequirementsModalProps {
  employee: any;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onEmployeeUpdate: (employee: any) => void;
  generateUploadUrl: () => Promise<string>;
  onPreviewFile: (file: { url: string; name: string; type: string }) => void;
  fileMetadataCache: React.MutableRefObject<{
    [key: string]: {
      url: string;
      type: "image" | "pdf" | "other";
      filename: string;
    };
  }>;
  getFileMetadata: (
    storageId: string,
    requirementType: string
  ) => Promise<{
    url: string;
    type: "image" | "pdf" | "other";
    filename: string;
  }>;
}

export function EmployeeRequirementsModal({
  employee,
  isOpen,
  onOpenChange,
  onEmployeeUpdate,
  generateUploadUrl,
  onPreviewFile,
  fileMetadataCache,
  getFileMetadata,
}: EmployeeRequirementsModalProps) {
  const { toast } = useToast();
  const [pendingStatusChanges, setPendingStatusChanges] = useState<{
    [key: number]: "submitted" | "not_submitted";
  }>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedReqIndexForUpload, setSelectedReqIndexForUpload] =
    useState<number>(-1);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [settingComplete, setSettingComplete] = useState(false);
  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});

  const handleUpdateStatus = async (
    employeeId: string,
    requirementIndex: number,
    status: "submitted" | "not_submitted"
  ) => {
    try {
      const backendStatus = status === "submitted" ? "verified" : "pending";
      await updateRequirementStatus({
        employeeId,
        requirementIndex,
        status: backendStatus,
      });
      toast({
        title: "Success",
        description: "Requirement status updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    }
  };

  const isAllComplete =
    (employee?.requirements?.length ?? 0) > 0 &&
    employee?.requirements?.every((r: any) => r.status === "verified");

  const handleSetComplete = async (complete: boolean) => {
    if (!employee) return;
    setSettingComplete(true);
    try {
      await setEmployeeRequirementsComplete({
        employeeId: employee._id,
        complete,
      });
      const newStatus = complete ? "verified" : "pending";
      const updatedRequirements = (employee.requirements || []).map(
        (r: any) => ({ ...r, status: newStatus })
      );
      onEmployeeUpdate({ ...employee, requirements: updatedRequirements });
      setPendingStatusChanges({});
      toast({
        title: "Success",
        description: complete
          ? "All requirements marked as complete"
          : "All requirements marked as incomplete",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    } finally {
      setSettingComplete(false);
    }
  };

  const handleRemoveRequirement = async (
    employeeId: string,
    requirementIndex: number
  ) => {
    try {
      await removeRequirement({
        employeeId,
        requirementIndex,
      });
      toast({
        title: "Success",
        description: "Requirement removed successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove requirement",
        variant: "destructive",
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const handleAddAttachment = (index: number) => {
    setTimeout(() => {
      const fileInput = fileInputRefs.current[index];
      if (fileInput) {
        fileInput.click();
      }
    }, 100);
  };

  const hasAnyPendingChanges = () => {
    return (
      Object.keys(pendingStatusChanges).length > 0 ||
      (selectedFile && selectedReqIndexForUpload >= 0)
    );
  };

  const handleSaveAllChanges = async () => {
    if (!employee) return;

    setUploadingFile(true);
    try {
      const updatedEmployee = { ...employee };
      if (!updatedEmployee.requirements) {
        updatedEmployee.requirements = [];
      }

      for (const [idxStr, status] of Object.entries(pendingStatusChanges)) {
        const idx = parseInt(idxStr);
        if (updatedEmployee.requirements[idx]) {
          updatedEmployee.requirements[idx] = {
            ...updatedEmployee.requirements[idx],
            status: status === "submitted" ? "verified" : "pending",
          };
        }
      }

      onEmployeeUpdate(updatedEmployee);

      for (const [idxStr, status] of Object.entries(pendingStatusChanges)) {
        const idx = parseInt(idxStr);
        await handleUpdateStatus(employee._id, idx, status);
      }

      if (selectedFile && selectedReqIndexForUpload >= 0) {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": selectedFile.type },
          body: selectedFile,
        });
        if (!result.ok) throw new Error("Failed to upload");
        const responseText = await result.text();
        let storageId: string;
        try {
          const jsonResponse = JSON.parse(responseText);
          storageId = jsonResponse.storageId || jsonResponse;
        } catch {
          storageId = responseText;
        }
        storageId = storageId.trim().replace(/^["']|["']$/g, "");
        await updateRequirementFile({
          employeeId: employee._id,
          requirementIndex: selectedReqIndexForUpload,
          file: storageId,
        });
      }

      setSelectedFile(null);
      setSelectedReqIndexForUpload(-1);
      setPendingStatusChanges({});

      toast({
        title: "Success",
        description: "All changes saved successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save changes",
        variant: "destructive",
      });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleCancelAllChanges = () => {
    setSelectedFile(null);
    setSelectedReqIndexForUpload(-1);
    setPendingStatusChanges({});
  };

  const handleRequirementAdded = () => {
    // Refresh employee data - this will be handled by parent
  };

  if (!employee) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {employee.personalInfo.firstName} {employee.personalInfo.lastName} -
            Requirements
          </DialogTitle>
          <DialogDescription>
            View and manage all requirements for this employee
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm text-gray-600 flex items-center gap-2">
                <span>Overall Status:</span>
                {isAllComplete ? (
                  <Badge className="bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none">
                    Complete
                  </Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-800 border-red-300 font-normal rounded-md hover:bg-red-100 focus:ring-0 focus:ring-offset-0 transition-none">
                    Incomplete
                  </Badge>
                )}
              </div>
              {employee.requirements && employee.requirements.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={settingComplete}
                  onClick={() => handleSetComplete(!isAllComplete)}
                  className="h-8 text-xs"
                >
                  {settingComplete
                    ? "Updating..."
                    : isAllComplete
                      ? "Mark as Incomplete"
                      : "Mark as Complete"}
                </Button>
              )}
            </div>
            <AddRequirementDialog
              employeeId={employee._id}
              onSuccess={handleRequirementAdded}
            />
          </div>

          <div className="space-y-3">
            {employee.requirements && employee.requirements.length > 0 ? (
              employee.requirements.map((req: any, idx: number) => {
                const isPassed = req.status === "verified";
                return (
                  <div key={idx} className="p-4 border rounded-lg space-y-4">
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={
                          pendingStatusChanges[idx] !== undefined
                            ? pendingStatusChanges[idx] === "submitted"
                            : req.status === "verified"
                        }
                        onChange={(e) => {
                          setPendingStatusChanges((prev) => ({
                            ...prev,
                            [idx]: e.target.checked
                              ? "submitted"
                              : "not_submitted",
                          }));
                        }}
                        className="h-4 w-4 rounded border-gray-300 mt-1 cursor-pointer"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium">{req.type}</span>
                          {req.isCustom && (
                            <Badge variant="outline" className="text-xs">
                              Custom
                            </Badge>
                          )}
                          <Badge
                            className={getStatusBadgeClass(
                              pendingStatusChanges[idx] !== undefined
                                ? pendingStatusChanges[idx] === "submitted"
                                  ? "submitted"
                                  : "not_submitted"
                                : isPassed
                                  ? "submitted"
                                  : "not_submitted"
                            )}
                            style={getStatusBadgeStyle(
                              pendingStatusChanges[idx] !== undefined
                                ? pendingStatusChanges[idx] === "submitted"
                                  ? "submitted"
                                  : "not_submitted"
                                : isPassed
                                  ? "submitted"
                                  : "not_submitted"
                            )}
                          >
                            {pendingStatusChanges[idx] !== undefined
                              ? pendingStatusChanges[idx] === "submitted"
                                ? "Submitted"
                                : "Not Submitted"
                              : isPassed
                                ? "Submitted"
                                : "Not Submitted"}
                          </Badge>
                        </div>
                        {req.file && (
                          <FileDisplay
                            storageId={req.file}
                            requirementType={req.type}
                            onPreview={async () => {
                              try {
                                const metadata = await getFileMetadata(
                                  req.file,
                                  req.type
                                );
                                onPreviewFile({
                                  url: metadata.url,
                                  name: metadata.filename,
                                  type: metadata.type,
                                });
                              } catch (error) {
                                console.error("Error loading file:", error);
                              }
                            }}
                            fileMetadataCache={fileMetadataCache}
                            getFileMetadata={getFileMetadata}
                          />
                        )}
                        {req.expiryDate && (
                          <p className="text-xs text-gray-500">
                            Expires:{" "}
                            {format(new Date(req.expiryDate), "MMM dd, yyyy")}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddAttachment(idx)}
                        >
                          <Upload className="h-3 w-3 mr-1" />
                          Add attachment
                        </Button>
                        <input
                          ref={(el) => {
                            fileInputRefs.current[idx] = el;
                          }}
                          type="file"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                          onChange={(e) => {
                            handleFileSelect(e);
                            if (e.target.files?.[0]) {
                              setSelectedReqIndexForUpload(idx);
                            }
                          }}
                          style={{ display: "none" }}
                        />
                        {req.isCustom && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (
                                confirm(
                                  "Are you sure you want to remove this custom requirement?"
                                )
                              ) {
                                await handleRemoveRequirement(
                                  employee._id,
                                  idx
                                );
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 text-red-600" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {selectedFile && selectedReqIndexForUpload === idx && (
                      <div className="text-sm text-gray-600 mt-2">
                        Selected: {selectedFile?.name} (
                        {((selectedFile?.size || 0) / 1024).toFixed(2)} KB)
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-gray-500 text-center py-8">
                No requirements assigned
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <div className="flex justify-between w-full">
            <div>
              {hasAnyPendingChanges() && (
                <Button
                  variant="outline"
                  onClick={handleCancelAllChanges}
                  disabled={uploadingFile}
                >
                  Cancel
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {hasAnyPendingChanges() && (
                <Button onClick={handleSaveAllChanges} disabled={uploadingFile}>
                  {uploadingFile ? "Saving..." : "Save"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  handleCancelAllChanges();
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
