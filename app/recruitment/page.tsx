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
import { Plus } from "lucide-react";
import { createJob } from "@/app/actions/recruitment";
import { updateDepartments } from "@/app/actions/settings";
import { useOrganization } from "@/hooks/organization-context";
import { useToast } from "@/components/ui/use-toast";

export default function RecruitmentPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganization();
  const { toast } = useToast();
  const jobs = useQuery(
    (api as any).recruitment.getJobs,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const applicants = useQuery(
    (api as any).recruitment.getApplicants,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );
  const settings = useQuery(
    (api as any).settings.getSettings,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
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

    if (existingDepartments.includes(trimmedName)) {
      toast({
        title: "Error",
        description: "This department already exists",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingDepartment(true);
    try {
      await updateDepartments({
        organizationId: currentOrganizationId,
        departments: [...existingDepartments, trimmedName],
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
      window.location.reload();
    } catch (error) {
      console.error("Error creating job:", error);
      alert("Failed to create job posting. Please try again.");
    }
  };

  // Main jobs list view
  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Recruitment</h1>
            <p className="text-gray-600 mt-2">
              Manage job postings and applicants
            </p>
          </div>
          <Dialog open={isJobDialogOpen} onOpenChange={setIsJobDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Job
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Job</DialogTitle>
                <DialogDescription>
                  Add a job to track applicants. All fields are optional.
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
                          settings.departments.map((dept: string) => (
                            <SelectItem key={dept} value={dept}>
                              {dept}
                            </SelectItem>
                          ))
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
                  <Button type="submit">Add Job</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-4">
          {jobs && jobs.length > 0 ? (
            jobs.map((job: any) => {
              const jobApplicants =
                applicants?.filter((a: any) => a.jobId === job._id) || [];
              return (
                <Card
                  key={job._id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => router.push(`/recruitment/${job._id}`)}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-xl">
                          {job.title || "Untitled Job"}
                        </CardTitle>
                        <p className="text-sm text-gray-600 mt-1">
                          {job.department}
                          {job.employmentType && ` • ${job.employmentType}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className={
                            job.status === "open"
                              ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none"
                              : "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none"
                          }
                        >
                          {job.status}
                        </Badge>
                        <span className="text-sm text-gray-500">
                          {jobApplicants.length} applicant
                          {jobApplicants.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                No job postings found. Create your first job posting to get
                started.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
