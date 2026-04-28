"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { usePayslipIdFromUrl } from "@/hooks/use-payslip-id-from-url";
import { getPayslip } from "@/actions/payroll";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2 } from "lucide-react";
import { PayslipDetail } from "@/components/payslip-detail";
import { payslipPinSessionKey } from "@/lib/payslip-session";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/ui/use-toast";

const STAFF_ROLES = new Set(["owner", "admin", "hr", "accounting"]);

/**
 * Global payslip viewer for `?payslipId=` (e.g. chat appeal "View Payslip").
 * — Staff: opens detail directly. — Employee: PIN in this dialog if required, then detail.
 */
export function PayslipDeepLinkModal() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const {
    effectiveOrganizationId,
    currentOrganization,
  } = useOrganization();
  const { isEmployeeExperienceUI } = useEmployeeView();
  const payslipId = usePayslipIdFromUrl();

  const user = useQuery(
    (api as any).organizations.getCurrentUser,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  const organization = useQuery(
    (api as any).organizations.getOrganization,
    effectiveOrganizationId
      ? { organizationId: effectiveOrganizationId }
      : "skip",
  );

  const payslipAccess = useQuery(
    (api as any).organizations.getEmployeeIdForPayslips,
    effectiveOrganizationId
      ? {
          organizationId: effectiveOrganizationId as Id<"organizations">,
          employeeExperienceMode: Boolean(isEmployeeExperienceUI),
        }
      : "skip",
  );

  const verifyPayslipPin = useAction((api as any).payslipPin.verifyPayslipPin);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"pin" | "load" | "view">("load");
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const orgId = effectiveOrganizationId;
  const employeeId = payslipAccess?.employeeId ?? null;
  const requiresPin = payslipAccess?.requiresPin ?? false;
  const roleRaw = (user?.role ?? currentOrganization?.role ?? "")
    .toString()
    .toLowerCase();
  /** HR/admin/accounting/owner: open payslip directly. Employee (or "view as employee") uses PIN if configured. */
  const treatAsStaff =
    !isEmployeeExperienceUI && STAFF_ROLES.has(roleRaw);
  const treatAsEmployee = !treatAsStaff;

  const clearQuery = useCallback(() => {
    if (typeof window === "undefined" || !pathname) {
      setOpen(false);
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.delete("payslipId");
    const next = u.pathname + (u.search && u.search !== "?" ? u.search : "");
    router.replace(next || pathname, { scroll: false });
    setOpen(false);
  }, [pathname, router]);

  // Drive open state from URL (after client knows payslipId).
  useEffect(() => {
    if (!payslipId || !orgId) {
      setOpen(false);
      setDetails(null);
      setPhase("load");
      setLoadError(null);
      return;
    }
    setOpen(true);
    setLoadError(null);
    setDetails(null);
    setPinValue("");
    setPinError("");

    if (treatAsStaff) {
      setPhase("load");
      return;
    }

    if (payslipAccess === undefined) {
      setPhase("load");
      return;
    }

    if (!employeeId) {
      setPhase("view");
      setLoadError("No employee record for this account.");
      return;
    }

    if (requiresPin) {
      const k = payslipPinSessionKey(String(orgId));
      if (typeof window !== "undefined" && sessionStorage.getItem(k) === "1") {
        setPhase("load");
      } else {
        setPhase("pin");
      }
    } else {
      setPhase("load");
    }
  }, [payslipId, orgId, treatAsStaff, requiresPin, employeeId, payslipAccess]);

  // Load payslip when phase is load and we have id.
  useEffect(() => {
    if (!open || !payslipId || !orgId) return;
    if (phase !== "load") return;
    if (treatAsStaff && user === undefined && !currentOrganization) return;
    if (treatAsEmployee && (payslipAccess === undefined || !employeeId)) return;

    let cancelled = false;

    const run = async () => {
      try {
        const d = await getPayslip(payslipId);
        if (cancelled || !d) {
          if (!cancelled) setLoadError("Payslip not found");
          return;
        }
        if (treatAsEmployee && employeeId) {
          if (String(d.employeeId) !== String(employeeId)) {
            setLoadError("You can only view your own payslips.");
            return;
          }
        }
        setDetails(d);
        setPhase("view");
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message || "Failed to load payslip");
          toast({
            title: "Could not open payslip",
            description: e?.message || "Try again or open from Payslips.",
            variant: "destructive",
          });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    phase,
    payslipId,
    orgId,
    treatAsStaff,
    treatAsEmployee,
    employeeId,
    payslipAccess,
    currentOrganization,
    user,
    toast,
  ]);

  const handlePinSubmit = async () => {
    if (!employeeId || !pinValue.trim()) {
      setPinError("Please enter your PIN");
      return;
    }
    setPinError("");
    setIsVerifyingPin(true);
    try {
      const result = await verifyPayslipPin({
        employeeId: employeeId as Id<"employees">,
        pin: pinValue.trim(),
      });
      if (result.valid) {
        if (orgId) {
          sessionStorage.setItem(payslipPinSessionKey(String(orgId)), "1");
        }
        setPhase("load");
        setPinValue("");
      } else {
        setPinError("Incorrect PIN. Please try again.");
      }
    } catch (e: any) {
      setPinError(e?.message || "Verification failed");
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    if (!next) {
      clearQuery();
      setDetails(null);
      setPhase("load");
      setLoadError(null);
    }
  };

  if (!payslipId || !orgId) return null;

  const title =
    phase === "pin"
      ? "Enter payslip PIN"
      : loadError
        ? "Payslip"
        : details
          ? "Payslip"
          : "Loading payslip…";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {phase === "pin" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Lock className="h-4 w-4 text-brand-purple shrink-0" />
              <span>Enter your PIN to view this payslip from the appeal link.</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deeplink-payslip-pin">PIN</Label>
              <Input
                id="deeplink-payslip-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pinValue}
                onChange={(e) => {
                  setPinValue(e.target.value.replace(/\D/g, "").slice(0, 8));
                  setPinError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && void handlePinSubmit()}
              />
              {pinError ? (
                <p className="text-sm text-red-600">{pinError}</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handlePinSubmit()}
                disabled={isVerifyingPin || !pinValue.trim()}
              >
                {isVerifyingPin ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  "View payslip"
                )}
              </Button>
            </div>
          </div>
        )}

        {phase === "load" && !loadError && (
          <div className="py-10 flex items-center justify-center text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        )}

        {loadError && (
          <p className="text-sm text-red-600 py-4">{loadError}</p>
        )}

        {phase === "view" && details && (
          <PayslipDetail
            payslip={details}
            employee={details.employee}
            organization={organization}
            cutoffStart={details.cutoffStart}
            cutoffEnd={details.cutoffEnd}
          />
        )}

        {(phase === "view" || loadError) && (
          <div className="flex justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
