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
  Trash2,
  UserCog,
  Mail,
} from "lucide-react";

interface EmployeesTableProps {
  employees: any[] | undefined;
  isCreatingEmployee: boolean;
  isAdmin: boolean;
  updatingStatus: string | null;
  updatingRole: string | null;
  onRowClick: (employeeId: string) => void;
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
  onRemove: (employee: any, e: MouseEvent) => void;
  onInvite: (employee: any, e: MouseEvent) => void;
  sendingInvite: string | null;
  page: number;
  pageSize: number;
  totalEmployees: number;
  onPageChange: (page: number) => void;
}

export function EmployeesTable({
  employees,
  isCreatingEmployee,
  isAdmin,
  updatingStatus,
  updatingRole,
  onRowClick,
  onMessage,
  onUpdateStatus,
  onUpdateRole,
  onRemove,
  onInvite,
  sendingInvite,
  page,
  pageSize,
  totalEmployees,
  onPageChange,
}: EmployeesTableProps) {
  const totalPages = Math.max(1, Math.ceil(totalEmployees / pageSize));
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalEmployees);

  const paginatedEmployees = employees?.slice(startIndex, endIndex) || [];

  return (
    <>
      <Table
        className={isCreatingEmployee ? "opacity-40 pointer-events-none" : ""}
      >
        <TableHeader>
          <TableRow>
            <TableHead>Employee ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Position</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedEmployees.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500">
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
                <TableCell className="font-medium">
                  {employee.employment.employeeId}
                </TableCell>
                <TableCell>
                  {employee.personalInfo.firstName}{" "}
                  {employee.personalInfo.lastName}
                </TableCell>
                <TableCell>{employee.personalInfo.email}</TableCell>
                <TableCell>{employee.employment.position}</TableCell>
                <TableCell>{employee.employment.department}</TableCell>
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
                          onClick={(e) => onMessage(employee._id, e)}
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Send Message
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem
                            onClick={(e) => onInvite(employee, e)}
                            disabled={sendingInvite === employee._id}
                          >
                            <Mail className="h-4 w-4 mr-2" />
                            {sendingInvite === employee._id
                              ? "Sending..."
                              : "Send Invite"}
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
                              onClick={(e) => onUpdateRole(employee, "hr", e)}
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
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => onRemove(employee, e)}
                              className="text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove from Organization
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

      <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
        <div>
          Showing {totalEmployees === 0 ? 0 : startIndex + 1}–{endIndex} of{" "}
          {totalEmployees} employees
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
