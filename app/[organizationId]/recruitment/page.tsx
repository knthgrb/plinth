"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ChevronRight, Briefcase } from "lucide-react";
import { createJob } from "@/actions/recruitment";
import { updateDepartments } from "@/actions/settings";
import { useOrganization } from "@/hooks/organization-context";
import { getOrganizationPath } from "@/utils/organization-routing";
import { useToast } from "@/components/ui/use-toast";

export default function RecruitmentPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const jobs = useQuery(
    (api as any).recruitment.getJobs,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const applicants = useQuery(
    (api as any).recruitment.getApplicants,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const [isJobDialogOpen, setIsJobDialogOpen] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [isCreatingDepartment, setIsCreatingDepartment] = useState(false);
  const [jobFormData, setJobFormData] = useState({
    title: "",
    department: "",
    employmentType: "",
    numberOfOpenings: "1",
    description: "",
    requirements: "",
    qualifications: "",
  });

  const [applicantFormData, setApplicantFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    coverLetter: "",
  });

  const handleCreateDepartment = async () => {
    if (!currentOrganizationId || !newDepartmentName.trim()) return;

    const trimmedName = newDepartmentName.trim();
    const existingDepartments = settings?.departments || [];

    const existingNames = existingDepartments.map(
      (d: string | { name: string }) => (typeof d === "string" ? d : d.name),
    );
    if (existingNames.includes(trimmedName)) {
      toast({
        title: "Error",
        description: "This department already exists",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingDepartment(true);
    try {
      const departmentsToSave = existingDepartments.map(
        (d: string | { name: string; color?: string }) =>
          typeof d === "string"
            ? { name: d, color: "#9CA3AF" }
            : { name: d.name, color: d.color ?? "#9CA3AF" },
      );
      await updateDepartments({
        organizationId: currentOrganizationId,
        departments: [
          ...departmentsToSave,
          { name: trimmedName, color: "#9CA3AF" },
        ],
      });

      // Set the newly created department in the form
      setJobFormData({
        ...jobFormData,
        department: trimmedName,
      });

      setNewDepartmentName("");
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
      setIsCreatingDepartment(false);
    }
  };

  const handleJobSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId) return;

    try {
      await createJob({
        organizationId: currentOrganizationId,
        title: jobFormData.title || undefined,
        department: jobFormData.department || undefined,
        employmentType: jobFormData.employmentType || undefined,
        numberOfOpenings: jobFormData.numberOfOpenings
          ? parseInt(jobFormData.numberOfOpenings)
          : undefined,
        description: jobFormData.description || undefined,
        requirements: jobFormData.requirements
          ? jobFormData.requirements.split("\n").filter((r) => r.trim())
          : undefined,
        qualifications: jobFormData.qualifications
          ? jobFormData.qualifications.split("\n").filter((q) => q.trim())
          : undefined,
      });
      setIsJobDialogOpen(false);
      setJobFormData({
        title: "",
        department: "",
        employmentType: "",
        numberOfOpenings: "1",
        description: "",
        requirements: "",
        qualifications: "",
      });
      toast({
        title: "Success",
        description: "Position added. You can now track applicants.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.message || "Failed to create position. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Main jobs list view
  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[rgb(64,64,64)]">
              Recruitment
            </h1>
            <p className="text-sm text-[rgb(133,133,133)] mt-1">
              Track open positions and applicants
            </p>
          </div>
          <Dialog open={isJobDialogOpen} onOpenChange={setIsJobDialogOpen}>
            {jobs && jobs.length > 0 && (
              <DialogTrigger asChild>
                <Button className="bg-[#695eff] hover:bg-[#5547e8] text-white shrink-0">
                  <Plus className="mr-2 h-4 w-4" />
                  Add position
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add position</DialogTitle>
                <DialogDescription>
                  Add a position to track applicants. All fields are optional.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleJobSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Job Title</Label>
                    <Input
                      id="title"
                      value={jobFormData.title}
                      onChange={(e) =>
                        setJobFormData({
                          ...jobFormData,
                          title: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Select
                      value={jobFormData.department}
                      onValueChange={(value) =>
                        setJobFormData({
                          ...jobFormData,
                          department: value,
                        })
                      }
                    >
                      <SelectTrigger id="department">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {settings?.departments &&
                        settings.departments.length > 0 ? (
                          settings.departments.map(
                            (
                              dept: string | { name: string; color?: string },
                            ) => {
                              const name =
                                typeof dept === "string" ? dept : dept.name;
                              return (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              );
                            },
                          )
                        ) : (
                          <div className="px-2 py-3 space-y-3">
                            <p className="text-sm text-gray-500">
                              No departments available
                            </p>
                            <div className="flex gap-2">
                              <Input
                                placeholder="Department name"
                                value={newDepartmentName}
                                onChange={(e) =>
                                  setNewDepartmentName(e.target.value)
                                }
                                onKeyPress={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleCreateDepartment();
                                  }
                                }}
                                className="h-8 text-sm"
                              />
                              <Button
                                size="sm"
                                onClick={handleCreateDepartment}
                                disabled={
                                  isCreatingDepartment ||
                                  !newDepartmentName.trim()
                                }
                              >
                                {isCreatingDepartment ? (
                                  "Creating..."
                                ) : (
                                  <>
                                    <Plus className="h-3 w-3 mr-1" />
                                    Create
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="employmentType">Employment Type</Label>
                      <Select
                        value={jobFormData.employmentType}
                        onValueChange={(value) =>
                          setJobFormData({
                            ...jobFormData,
                            employmentType: value,
                          })
                        }
                      >
                        <SelectTrigger id="employmentType">
                          <SelectValue placeholder="Select employment type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Full Time">Full Time</SelectItem>
                          <SelectItem value="Part Time">Part Time</SelectItem>
                          <SelectItem value="Contract">Contract</SelectItem>
                          <SelectItem value="Temporary">Temporary</SelectItem>
                          <SelectItem value="Internship">Internship</SelectItem>
                          <SelectItem value="Freelance">Freelance</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="numberOfOpenings">
                        Number of Openings
                      </Label>
                      <Input
                        id="numberOfOpenings"
                        type="number"
                        value={jobFormData.numberOfOpenings}
                        onChange={(e) =>
                          setJobFormData({
                            ...jobFormData,
                            numberOfOpenings: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      rows={4}
                      value={jobFormData.description}
                      onChange={(e) =>
                        setJobFormData({
                          ...jobFormData,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="requirements">Requirements</Label>
                    <Textarea
                      id="requirements"
                      rows={4}
                      value={jobFormData.requirements}
                      onChange={(e) =>
                        setJobFormData({
                          ...jobFormData,
                          requirements: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="qualifications">Qualifications</Label>
                    <Textarea
                      id="qualifications"
                      rows={4}
                      value={jobFormData.qualifications}
                      onChange={(e) =>
                        setJobFormData({
                          ...jobFormData,
                          qualifications: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsJobDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-[#695eff] hover:bg-[#5547e8] text-white"
                  >
                    Add position
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-3">
          {jobs && jobs.length > 0 ? (
            jobs.map((job: any) => {
              const jobApplicants =
                applicants?.filter((a: any) => a.jobId === job._id) || [];
              return (
                <Card
                  key={job._id}
                  className="cursor-pointer hover:shadow-md transition-shadow border border-[#DDDDDD] rounded-xl overflow-hidden"
                  onClick={() =>
                    router.push(
                      getOrganizationPath(
                        currentOrganizationId,
                        `/recruitment/${job._id}`,
                      ),
                    )
                  }
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgb(245,243,255)] text-[#695eff]">
                          <Briefcase className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-semibold text-[rgb(64,64,64)] truncate">
                            {job.title || "Untitled position"}
                          </h2>
                          <p className="text-sm text-[rgb(133,133,133)] mt-0.5">
                            {typeof job.department === "string"
                              ? job.department
                              : ((job.department as { name?: string })?.name ??
                                "—")}
                            {job.employmentType && ` • ${job.employmentType}`}
                            {job.numberOfOpenings != null &&
                              job.numberOfOpenings > 0 &&
                              ` • ${job.numberOfOpenings} opening${job.numberOfOpenings !== 1 ? "s" : ""}`}
                          </p>
                          <p className="text-xs text-[rgb(133,133,133)] mt-1">
                            {jobApplicants.length} applicant
                            {jobApplicants.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className={
                            job.status === "open"
                              ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none capitalize"
                              : "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none capitalize"
                          }
                        >
                          {job.status === "open" ? "Open" : "Archived"}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-[rgb(133,133,133)]" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card className="border border-[#DDDDDD] rounded-xl">
              <CardContent className="py-12 text-center">
                <Briefcase className="h-12 w-12 mx-auto text-[rgb(200,200,200)] mb-3" />
                <p className="text-[rgb(133,133,133)] font-medium">
                  No positions yet
                </p>
                <p className="text-sm text-[rgb(133,133,133)] mt-1">
                  Add a position to start tracking applicants.
                </p>
                <Button
                  className="mt-4 bg-[#695eff] hover:bg-[#5547e8] text-white"
                  onClick={() => setIsJobDialogOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add position
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
