"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import { usePayslipIdFromUrl } from "@/hooks/use-payslip-id-from-url";
import { downloadPayslipPdf, getPayslip } from "@/actions/payroll";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Lock, Loader2 } from "lucide-react";
import { PayslipDetail } from "@/components/payslip-detail";
import {
  PAYSLIP_NOT_FOUND,
  PAYSLIP_PIN_VERIFY_GENERIC,
  userFacingPayslipLoadError,
} from "@/lib/payslip-load-errors";
import type { Id } from "@/convex/_generated/dataModel";
import { useToast } from "@/components/ui/use-toast";
import { removeOrganizationId } from "@/utils/organization-routing";
import { payslipPdfPasswordDescription } from "@/lib/payslip-pdf-password";

const STAFF_ROLES = new Set(["owner", "admin", "hr", "accounting"]);

/**
 * Global payslip viewer for `?payslipId=` (e.g. chat appeal "View Payslip").
 * — Staff: opens detail directly. — Employee: PIN in this dialog if required, then detail.
 */
export function PayslipDeepLinkModal() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const routeSegments = pathname?.split("/").filter(Boolean) ?? [];
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
  const [downloadingPayslipId, setDownloadingPayslipId] = useState<
    string | null
  >(null);

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

  const prevPathnameForPayslipDeeplinkRef = useRef<string | null>(null);

  /**
   * Drop `?payslipId=` when the user in-app navigates to another page (e.g. they
   * opened a notification on payslips then used the sidebar) so the global PIN
   * modal does not follow them. Cold loads to e.g. `/…/chat?payslipId=` still work
   * (no previous pathname in this tab session).
   */
  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;

    const u = new URL(window.location.href);
    const hasPayslipParam = Boolean(u.searchParams.get("payslipId"));
    const pathWithoutOrg = removeOrganizationId(pathname) || "/";
    const onPayslips =
      pathWithoutOrg === "/payslips" || pathWithoutOrg.startsWith("/payslips/");

    if (onPayslips || !hasPayslipParam) {
      prevPathnameForPayslipDeeplinkRef.current = pathname;
      return;
    }

    const previous = prevPathnameForPayslipDeeplinkRef.current;
    prevPathnameForPayslipDeeplinkRef.current = pathname;

    if (previous != null && previous !== pathname) {
      u.searchParams.delete("payslipId");
      const next =
        u.pathname + (u.search && u.search !== "?" ? u.search : "");
      router.replace(next, { scroll: false });
    }
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
      setPhase("pin");
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
          if (!cancelled) setLoadError(PAYSLIP_NOT_FOUND);
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
      } catch (error: unknown) {
        if (!cancelled) {
          const copy = userFacingPayslipLoadError(error);
          setLoadError(copy);
          toast({
            title: "Could not open payslip",
            description: copy,
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

  const handleDownloadPayslipPdf = async (payslip: { _id: string }) => {
    try {
      setDownloadingPayslipId(String(payslip._id));
      const { pdfBase64, fileName } = await downloadPayslipPdf(
        String(payslip._id),
      );
      const binary = atob(pdfBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Payslip downloaded",
        description: `To open the file: ${payslipPdfPasswordDescription()}`,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Download failed";
      toast({
        title: "Download failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDownloadingPayslipId(null);
    }
  };

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
        setPhase("load");
        setPinValue("");
      } else {
        setPinError("Incorrect PIN. Please try again.");
      }
    } catch {
      setPinError(PAYSLIP_PIN_VERIFY_GENERIC);
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

  /** My Payslips owns `?payslipId=` (PIN gate + detail dialog). */
  if (routeSegments[routeSegments.length - 1] === "payslips") {
    return null;
  }

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
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {phase === "view" && details ? (
              <Button
                type="button"
                variant="outline"
                disabled={downloadingPayslipId === String(details._id)}
                onClick={() => void handleDownloadPayslipPdf(details)}
              >
                {downloadingPayslipId === String(details._id) ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
