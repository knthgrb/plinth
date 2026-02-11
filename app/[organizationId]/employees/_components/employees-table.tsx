"use client";

import { MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  MoreVertical,
  Pencil,
  Trash2,
  UserCog,
  UserMinus,
  Mail,
} from "lucide-react";

interface EmployeesTableProps {
  employees: any[] | undefined;
  isCreatingEmployee: boolean;
  isAdmin: boolean;
  updatingStatus: string | null;
  updatingRole: string | null;
  onRowClick: (employeeId: string) => void;
  onEdit: (employeeId: string) => void;
  onMessage: (employeeId: string, e: MouseEvent) => void;
  onUpdateStatus: (
    employee: any,
    newStatus: "active" | "inactive" | "resigned" | "terminated",
    e: MouseEvent
  ) => void;
  onUpdateRole: (
    employee: any,
    newRole: "admin" | "hr" | "employee",
    e: MouseEvent
  ) => void;
  onRemoveFromOrganization: (employee: any, e: MouseEvent) => void;
  onDeleteEmployee: (employee: any, e: MouseEvent) => void;
  onInvite: (employee: any, e: MouseEvent) => void;
  sendingInvite: string | null;
  page: number;
  pageSize: number;
  totalEmployees: number;
  onPageChange: (page: number) => void;
  employeesUserAccounts: Record<string, boolean>;
}

export function EmployeesTable({
  employees,
  isCreatingEmployee,
  isAdmin,
  updatingStatus,
  updatingRole,
  onRowClick,
  onEdit,
  onMessage,
  onUpdateStatus,
  onUpdateRole,
  onRemoveFromOrganization,
  onDeleteEmployee,
  onInvite,
  sendingInvite,
  page,
  pageSize,
  totalEmployees,
  onPageChange,
  employeesUserAccounts,
}: EmployeesTableProps) {
  const totalPages = Math.max(1, Math.ceil(totalEmployees / pageSize));
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalEmployees);

  const paginatedEmployees = employees?.slice(startIndex, endIndex) || [];

  return (
    <>
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <div className="inline-block min-w-full align-middle">
          <div className="overflow-hidden">
            <Table
              className={
                isCreatingEmployee ? "opacity-40 pointer-events-none" : ""
              }
            >
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[150px]">Name</TableHead>
                  <TableHead className="min-w-[180px] hidden sm:table-cell">
                    Email
                  </TableHead>
                  <TableHead className="min-w-[120px]">Position</TableHead>
                  <TableHead className="min-w-[120px] hidden md:table-cell">
                    Department
                  </TableHead>
                  <TableHead className="min-w-[100px]">Status</TableHead>
                  <TableHead className="text-right min-w-[80px]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-gray-500 py-8"
                    >
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedEmployees.map((employee: any) => (
                    <TableRow
                      key={employee._id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => onRowClick(employee._id)}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span>
                            {employee.personalInfo.firstName}{" "}
                            {employee.personalInfo.lastName}
                          </span>
                          <span className="text-xs text-gray-500 sm:hidden">
                            {employee.personalInfo.email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {employee.personalInfo.email}
                      </TableCell>
                      <TableCell>{employee.employment.position}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {employee.employment.department}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            employee.employment.status === "active"
                              ? "bg-[#DCF7DC] border-[#A1E6A1] text-[#2E892E] font-normal rounded-md hover:bg-[#DCF7DC] focus:ring-0 focus:ring-offset-0 transition-none"
                              : "bg-gray-100 text-gray-800 hover:bg-gray-100 border-gray-200 rounded-md focus:ring-0 focus:ring-offset-0 transition-none"
                          }
                        >
                          {employee.employment.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEdit(employee._id);
                                }}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {/* Only show Send Message if employee has a user account */}
                              {employeesUserAccounts[employee._id] && (
                                <DropdownMenuItem
                                  onClick={(e) => onMessage(employee._id, e)}
                                >
                                  <MessageSquare className="h-4 w-4 mr-2" />
                                  Send Message
                                </DropdownMenuItem>
                              )}
                              {isAdmin &&
                                !employeesUserAccounts[employee._id] && (
                                  <DropdownMenuItem
                                    onClick={(e) => onInvite(employee, e)}
                                    disabled={sendingInvite === employee._id}
                                  >
                                    <Mail className="h-4 w-4 mr-2" />
                                    {sendingInvite === employee._id
                                      ? "Creating..."
                                      : "Create User Account"}
                                  </DropdownMenuItem>
                                )}
                              <DropdownMenuSeparator />
                              {employee.employment.status === "active" ? (
                                <DropdownMenuItem
                                  onClick={(e) =>
                                    onUpdateStatus(employee, "inactive", e)
                                  }
                                  disabled={updatingStatus === employee._id}
                                >
                                  <Archive className="h-4 w-4 mr-2" />
                                  Archive (Deactivate)
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={(e) =>
                                    onUpdateStatus(employee, "active", e)
                                  }
                                  disabled={updatingStatus === employee._id}
                                >
                                  <ArchiveRestore className="h-4 w-4 mr-2" />
                                  Reactivate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={(e) =>
                                  onUpdateStatus(employee, "resigned", e)
                                }
                                disabled={updatingStatus === employee._id}
                              >
                                <Archive className="h-4 w-4 mr-2" />
                                Mark as Resigned
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) =>
                                  onUpdateStatus(employee, "terminated", e)
                                }
                                disabled={updatingStatus === employee._id}
                              >
                                <Archive className="h-4 w-4 mr-2" />
                                Mark as Terminated
                              </DropdownMenuItem>
                              {isAdmin && (
                                <>
                                  {/* Role options only available if employee has user account */}
                                  {employeesUserAccounts[employee._id] && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={(e) =>
                                          onUpdateRole(employee, "admin", e)
                                        }
                                        disabled={updatingRole === employee._id}
                                      >
                                        <UserCog className="h-4 w-4 mr-2" />
                                        Set as Admin
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={(e) =>
                                          onUpdateRole(employee, "hr", e)
                                        }
                                        disabled={updatingRole === employee._id}
                                      >
                                        <UserCog className="h-4 w-4 mr-2" />
                                        Set as HR
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={(e) =>
                                          onUpdateRole(employee, "employee", e)
                                        }
                                        disabled={updatingRole === employee._id}
                                      >
                                        <UserCog className="h-4 w-4 mr-2" />
                                        Set as Employee
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  {employeesUserAccounts[employee._id] && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={(e) =>
                                          onRemoveFromOrganization(employee, e)
                                        }
                                        className="text-amber-600"
                                      >
                                        <UserMinus className="h-4 w-4 mr-2" />
                                        Remove from Organization
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={(e) =>
                                      onDeleteEmployee(employee, e)
                                    }
                                    className="text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Employee
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between mt-4 gap-3 text-sm text-gray-600 px-4 sm:px-0">
        <div className="text-center sm:text-left">
          Showing {totalEmployees === 0 ? 0 : startIndex + 1}–{endIndex} of{" "}
          {totalEmployees} employees
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="text-xs sm:text-sm"
          >
            Previous
          </Button>
          <span className="text-xs sm:text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="text-xs sm:text-sm"
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
