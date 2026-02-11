"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Edit } from "lucide-react";
import { getEmployeeLeaveCredits } from "@/actions/leave";
import { calculateAnniversaryLeave } from "@/utils/leave-calculations";

const PAGE_SIZE = 20;

interface LeaveCreditsTableProps {
  employees: any[];
  organizationId: string;
  onEdit: (employeeId: string) => void;
}

export function LeaveCreditsTable({
  employees,
  organizationId,
  onEdit,
}: LeaveCreditsTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [creditsMap, setCreditsMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  const paginatedEmployees = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return (employees || []).slice(start, start + PAGE_SIZE);
  }, [employees, currentPage]);

  const customTypes = useMemo(() => {
    const types = new Set<string>();
    Object.values(creditsMap).forEach((c: any) => {
      (c?.custom || []).forEach((x: any) => types.add(x.type));
    });
    return Array.from(types);
  }, [creditsMap]);

  useEffect(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageEmployees = (employees || []).slice(start, start + PAGE_SIZE);
    if (!organizationId || pageEmployees.length === 0) {
      setCreditsMap({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      pageEmployees.map((emp: any) =>
        getEmployeeLeaveCredits(organizationId, emp._id).then((credits) => ({
          id: emp._id,
          credits,
        }))
      )
    )
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, any> = {};
        results.forEach(({ id, credits }) => {
          map[id] = credits;
        });
        setCreditsMap(map);
      })
      .catch(() => {
        if (!cancelled) setCreditsMap({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, currentPage, employees]);

  const totalPages = Math.max(
    1,
    Math.ceil((employees?.length || 0) / PAGE_SIZE)
  );
  const from = (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, employees?.length || 0);

  if (!employees?.length) {
    return (
      <div className="rounded-lg border border-[rgb(230,230,230)] bg-[rgb(250,250,250)] py-12 text-center text-sm text-[rgb(133,133,133)]">
        No employees to display.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(230,230,230)] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[rgb(250,250,250)] hover:bg-[rgb(250,250,250)] border-b border-[rgb(230,230,230)]">
            <TableHead className="font-semibold text-[rgb(64,64,64)] text-xs">
              Employee
            </TableHead>
            <TableHead className="font-semibold text-[rgb(64,64,64)] text-xs">
              Vacation (balance)
            </TableHead>
            <TableHead className="font-semibold text-[rgb(64,64,64)] text-xs">
              Sick (balance)
            </TableHead>
            {customTypes.map((type) => (
              <TableHead
                key={type}
                className="font-semibold text-[rgb(64,64,64)] text-xs"
              >
                {type} (balance)
              </TableHead>
            ))}
            <TableHead className="font-semibold text-[rgb(64,64,64)] text-xs w-[100px]">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell
                colSpan={3 + customTypes.length + 1}
                className="text-center py-8 text-sm text-[rgb(133,133,133)]"
              >
                Loading leave credits…
              </TableCell>
            </TableRow>
          ) : (
            paginatedEmployees.map((emp: any) => {
              const credits = creditsMap[emp._id];
              const name =
                `${emp.personalInfo?.firstName ?? ""} ${emp.personalInfo?.lastName ?? ""}`.trim() ||
                "—";
              const vacBalance = credits?.vacation?.balance ?? "—";
              const sickBalance = credits?.sick?.balance ?? "—";
              return (
                <TableRow
                  key={emp._id}
                  className="border-b border-[rgb(230,230,230)] hover:bg-[rgb(250,250,250)]"
                >
                  <TableCell className="text-sm font-medium text-[rgb(64,64,64)]">
                    {name}
                  </TableCell>
                  <TableCell className="text-sm text-[rgb(64,64,64)]">
                    {typeof vacBalance === "number"
                      ? `${vacBalance} days`
                      : vacBalance}
                  </TableCell>
                  <TableCell className="text-sm text-[rgb(64,64,64)]">
                    {typeof sickBalance === "number"
                      ? `${sickBalance} days`
                      : sickBalance}
                  </TableCell>
                  {customTypes.map((type) => {
                    const custom = credits?.custom?.find(
                      (c: any) => c.type === type
                    );
                    const used = custom?.used ?? 0;
                    // Anniversary leave: total = +1 per year from hire/regularization, balance = total - used
                    const isAnniversary = type === "anniversary";
                    const anniversaryTotal = isAnniversary
                      ? calculateAnniversaryLeave(
                          emp.employment?.regularizationDate ??
                            emp.employment?.hireDate
                        )
                      : null;
                    const bal =
                      isAnniversary && anniversaryTotal !== null
                        ? Math.max(0, anniversaryTotal - used)
                        : (custom?.balance ?? "—");
                    return (
                      <TableCell
                        key={type}
                        className="text-sm text-[rgb(64,64,64)]"
                      >
                        {typeof bal === "number" ? `${bal} days` : bal}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-[rgb(230,230,230)]"
                      onClick={() => onEdit(emp._id)}
                    >
                      <Edit className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {!loading && employees.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-[rgb(230,230,230)] bg-[rgb(250,250,250)]">
          <p className="text-xs font-medium text-[rgb(133,133,133)]">
            {from}–{to} of {employees.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-[rgb(230,230,230)]"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-[rgb(230,230,230)]"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
