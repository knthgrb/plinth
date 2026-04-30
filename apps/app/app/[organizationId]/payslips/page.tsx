"use client";

import { Suspense, useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Download,
  Eye,
  EyeOff,
  FileText,
  MessageSquare,
  Filter,
  Lock,
  KeyRound,
  Loader2,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, parse } from "date-fns";
import { useRouter } from "next/navigation";
import { useOrganization } from "@/hooks/organization-context";
import { useEmployeeView } from "@/hooks/employee-view-context";
import type { Id } from "@/convex/_generated/dataModel";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PayslipDetail } from "@/components/payslip-detail";
import { downloadPayslipPdf, getPayslip } from "@/actions/payroll";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getOrCreateConversation } from "@/actions/chat";
import { useToast } from "@/components/ui/use-toast";
import {
  formatManilaShortDate,
  formatManilaShortMonthDay,
} from "@/lib/manila-date";
import { usePayslipIdFromUrl } from "@/hooks/use-payslip-id-from-url";
import { userFacingPayslipLoadError } from "@/lib/payslip-load-errors";
import { payslipPdfPasswordDescription } from "@/lib/payslip-pdf-password";

function formatPesoAmounts(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function maskPesoNumberPart(formatted: string): string {
  return formatted.replace(/[0-9]/g, "*");
}

function PayslipsPageContent() {
  const { toast } = useToast();
  const router = useRouter();
  const payslipIdFromUrl = usePayslipIdFromUrl();
  const { currentOrganizationId } = useOrganization();
  const { employeeViewActive, canUseEmployeeView } = useEmployeeView();

  const payslipAccess = useQuery(
    (api as any).organizations.getEmployeeIdForPayslips,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId as Id<"organizations">,
          employeeExperienceMode:
            Boolean(employeeViewActive && canUseEmployeeView),
        }
      : "skip",
  );

  const employeeId = payslipAccess?.employeeId ?? null;
  const requiresPin = payslipAccess?.requiresPin ?? false;

  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const organization = useQuery(
    (api as any).organizations.getOrganization,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const [pinVerified, setPinVerified] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [isSetPinOpen, setIsSetPinOpen] = useState(false);
  const [pinToSet, setPinToSet] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [isSetPdfPasswordOpen, setIsSetPdfPasswordOpen] = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [pdfPasswordConfirm, setPdfPasswordConfirm] = useState("");
  const [isSettingPdfPassword, setIsSettingPdfPassword] = useState(false);

  const verifyPayslipPin = useAction((api as any).payslipPin.verifyPayslipPin);
  const setPayslipPin = useAction((api as any).payslipPin.setPayslipPin);
  const setPayslipPdfPassword = useMutation(
    (api as any).employees.setPayslipPdfPassword,
  );
  const payslipPdfPasswordState = useQuery(
    (api as any).employees.getPayslipPdfPassword,
    employeeId ? { employeeId } : "skip",
  );

  const [selectedPayslip, setSelectedPayslip] = useState<any>(null);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [payslipDetails, setPayslipDetails] = useState<any>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedCutoff, setSelectedCutoff] = useState<string>("");
  const [downloadingPayslipId, setDownloadingPayslipId] = useState<
    string | null
  >(null);
  /** When not in this set, gross/deductions/net are masked in the table */
  const [revealedAmountRowIds, setRevealedAmountRowIds] = useState<Set<string>>(
    () => new Set(),
  );
  /** Avoid re-opening the same notification deeplink on every render */
  const openedPayslipFromUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (payslipIdFromUrl == null) {
      openedPayslipFromUrlRef.current = null;
    }
  }, [payslipIdFromUrl]);

  // Radix Select disallows empty-string item values. We use sentinel values and map them to "" state.
  const ALL_MONTHS_VALUE = "__all_months__";
  const ALL_CUTOFFS_VALUE = "__all_cutoffs__";

  const payslips = useQuery(
    (api as any).payroll.getEmployeePayslips,
    employeeId ? { employeeId } : "skip",
  );

  // Get employee details
  const employee = useQuery(
    (api as any).employees.getEmployee,
    employeeId ? { employeeId } : "skip",
  );

  const appealRecipient = useQuery(
    (api as any).chat.getPayrollAppealRecipient,
    currentOrganizationId
      ? {
          organizationId: currentOrganizationId as Id<"organizations">,
          excludeUserId: user?._id as Id<"users"> | undefined,
        }
      : "skip",
  );

  // Filter payslips by month and cutoff
  const filteredPayslips = useMemo(() => {
    if (!payslips) return [];

    let filtered = [...payslips];

    // Filter by month
    if (selectedMonth) {
      const [year, month] = selectedMonth.split("-");
      const monthStart = startOfMonth(
        new Date(parseInt(year), parseInt(month) - 1),
      );
      const monthEnd = endOfMonth(monthStart);

      filtered = filtered.filter((payslip: any) => {
        const payslipDate = new Date(payslip.createdAt);
        return payslipDate >= monthStart && payslipDate <= monthEnd;
      });
    }

    // Filter by cutoff period (extract from period string)
    if (selectedCutoff) {
      filtered = filtered.filter((payslip: any) => {
        return payslip.period?.includes(selectedCutoff) || false;
      });
    }

    return filtered;
  }, [payslips, selectedMonth, selectedCutoff]);

  // Get unique months and cutoff periods for filters
  const availableMonths = useMemo(() => {
    if (!payslips) return [];
    const months = new Set<string>();
    payslips.forEach((payslip: any) => {
      const date = new Date(payslip.createdAt);
      months.add(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      );
    });
    return Array.from(months).sort().reverse();
  }, [payslips]);

  const availableCutoffs = useMemo(() => {
    if (!payslips) return [];
    const cutoffs = new Set<string>();
    payslips.forEach((payslip: any) => {
      if (payslip.period) {
        // Extract cutoff info from period string (e.g., "12/3/2025 to 12/10/2025")
        const match = payslip.period.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (match) {
          cutoffs.add(payslip.period);
        }
      }
    });
    return Array.from(cutoffs).sort().reverse();
  }, [payslips]);

  const selectedPayslipPeriodTitle =
    selectedPayslip?.cutoffStart != null && selectedPayslip?.cutoffEnd != null
      ? `${formatManilaShortMonthDay(selectedPayslip.cutoffStart)} to ${formatManilaShortDate(selectedPayslip.cutoffEnd)}`
      : selectedPayslip?.period;

  const toggleRowAmountVisibility = (payslipId: string) => {
    setRevealedAmountRowIds((prev) => {
      const next = new Set(prev);
      const k = String(payslipId);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const handleViewPayslip = async (payslip: any) => {
    setSelectedPayslip(payslip);
    setIsViewOpen(true);
    setIsLoadingDetails(true);
    try {
      const details = await getPayslip(payslip._id);
      setPayslipDetails(details);
    } catch (error: unknown) {
      console.error("Error loading payslip details:", error);
      toast({
        title: "Could not open payslip",
        description: userFacingPayslipLoadError(error),
        variant: "destructive",
      });
      setIsViewOpen(false);
      setSelectedPayslip(null);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  /**
   * We do not cache PIN in session storage: each visit to My Payslips and each
   * `?payslipId=` deeplink (see `PayslipDeepLinkModal`) requires the PIN when configured.
   */

  /**
   * Notification / chat links use `?payslipId=`. Never bypass PIN for that URL —
   * open the detail dialog only after the lock screen (or session) allows access.
   */
  useEffect(() => {
    if (!payslipIdFromUrl || !employeeId) return;
    if (requiresPin && !pinVerified) return;
    if (openedPayslipFromUrlRef.current === payslipIdFromUrl) return;

    openedPayslipFromUrlRef.current = payslipIdFromUrl;

    let cancelled = false;
    void (async () => {
      setIsLoadingDetails(true);
      try {
        const details = await getPayslip(payslipIdFromUrl);
        if (cancelled || !details) return;
        if (String(details.employeeId) !== String(employeeId)) {
          toast({
            title: "Could not open payslip",
            description:
              "This payslip is not associated with your employee record.",
            variant: "destructive",
          });
          openedPayslipFromUrlRef.current = null;
          return;
        }
        setSelectedPayslip(details);
        setPayslipDetails(details);
        setIsViewOpen(true);

        if (typeof window !== "undefined") {
          const u = new URL(window.location.href);
          u.searchParams.delete("payslipId");
          const q = u.search && u.search !== "?" ? u.search : "";
          router.replace(u.pathname + q, { scroll: false });
        }
      } catch (error: unknown) {
        openedPayslipFromUrlRef.current = null;
        toast({
          title: "Could not open payslip",
          description: userFacingPayslipLoadError(error),
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setIsLoadingDetails(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    payslipIdFromUrl,
    employeeId,
    requiresPin,
    pinVerified,
    router,
    toast,
  ]);

  const handleOpenComment = (payslip: any) => {
    setSelectedPayslip(payslip);
    setIsCommentOpen(true);
    setCommentText("");
  };

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

  const handleSendComment = async () => {
    if (
      !selectedPayslip ||
      !commentText.trim() ||
      !currentOrganizationId ||
      !user?._id
    ) {
      return;
    }

    setIsSendingComment(true);
    try {
      const recipientId = appealRecipient?.userId;
      if (!recipientId) {
        throw new Error(
          "No payroll contact found (need an owner, admin, or HR user in this organization)",
        );
      }

      const conversationId = await getOrCreateConversation({
        organizationId: currentOrganizationId,
        participantId: recipientId,
        directThreadKind: "standard",
      });

      const { sendMessage } = await import("@/actions/chat");
      await sendMessage({
        conversationId,
        content: `[Payslip appeal — ${selectedPayslip.period}]\n\n${commentText.trim()}`,
        payslipId: selectedPayslip._id,
      });

      toast({
        title: "Appeal sent",
        description:
          "Your message was delivered in Chat. The recipient opens Chat, finds this conversation, and can use View Payslip on the message.",
      });

      setIsCommentOpen(false);
      setCommentText("");
      setSelectedPayslip(null);
    } catch (error: any) {
      console.error("Error sending comment:", error);
      toast({
        title: "Error",
        description:
          error.message || "Failed to send comment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingComment(false);
    }
  };

  const handleVerifyPin = async () => {
    if (!employeeId || !pinValue.trim()) {
      setPinError("Please enter your PIN");
      return;
    }
    setPinError("");
    setIsVerifyingPin(true);
    try {
      const result = await verifyPayslipPin({
        employeeId,
        pin: pinValue.trim(),
      });
      if (result.valid) {
        setPinVerified(true);
        setPinValue("");
      } else {
        setPinError("Incorrect PIN. Please try again.");
      }
    } catch (e: any) {
      setPinError(e.message || "Verification failed");
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const handleSetPin = async () => {
    if (!employeeId || pinToSet.length < 4) {
      toast({
        title: "Invalid PIN",
        description: "PIN must be at least 4 characters",
        variant: "destructive",
      });
      return;
    }
    if (pinToSet !== pinConfirm) {
      toast({
        title: "PINs don't match",
        description: "Please confirm your PIN.",
        variant: "destructive",
      });
      return;
    }
    setIsSettingPin(true);
    try {
      await setPayslipPin({ employeeId, pin: pinToSet });
      toast({
        title: "PIN set",
        description: "You can now use this PIN to access your payslips.",
      });
      setIsSetPinOpen(false);
      setPinToSet("");
      setPinConfirm("");
    } catch (e: any) {
      toast({
        title: "Error",
        description: e.message || "Failed to set PIN",
        variant: "destructive",
      });
    } finally {
      setIsSettingPin(false);
    }
  };

  const handleSetPdfPassword = async () => {
    if (!employeeId) return;
    const trimmedPassword = pdfPassword.trim();
    const trimmedConfirm = pdfPasswordConfirm.trim();

    if (trimmedPassword.length > 0 && trimmedPassword.length < 4) {
      toast({
        title: "Invalid password",
        description: "Password must be at least 4 characters.",
        variant: "destructive",
      });
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      toast({
        title: "Passwords don't match",
        description: "Please confirm your password.",
        variant: "destructive",
      });
      return;
    }

    setIsSettingPdfPassword(true);
    try {
      await setPayslipPdfPassword({
        employeeId,
        password: trimmedPassword,
      });
      toast({
        title: trimmedPassword.length > 0 ? "Password updated" : "Password reset",
        description:
          trimmedPassword.length > 0
            ? "Your payslip PDF password has been updated."
            : "Your payslip PDF password is now your employee ID.",
      });
      setIsSetPdfPasswordOpen(false);
      setPdfPassword("");
      setPdfPasswordConfirm("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update payslip PDF password.",
        variant: "destructive",
      });
    } finally {
      setIsSettingPdfPassword(false);
    }
  };

  if (payslipAccess === undefined) {
    return (
      <MainLayout>
        <div className="p-8 flex items-center justify-center min-h-[200px]">
          <p className="text-gray-500">Loading...</p>
        </div>
      </MainLayout>
    );
  }

  if (!employeeId) {
    return (
      <MainLayout>
        <div className="p-8">
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-gray-500">
                No employee record found. Please contact HR.
              </p>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  if (requiresPin && !pinVerified) {
    return (
      <MainLayout>
        <div className="p-8 flex items-center justify-center min-h-[400px]">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Lock className="h-6 w-6 text-brand-purple" />
                <CardTitle>Enter payslip PIN</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">
                Enter your PIN to view your payslips.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="payslip-pin">PIN</Label>
                <Input
                  id="payslip-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Enter PIN"
                  value={pinValue}
                  onChange={(e) => {
                    setPinValue(e.target.value.replace(/\D/g, "").slice(0, 8));
                    setPinError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyPin()}
                />
                {pinError && <p className="text-sm text-red-600">{pinError}</p>}
              </div>
              <Button
                className="w-full"
                onClick={handleVerifyPin}
                disabled={isVerifyingPin || !pinValue.trim()}
              >
                {isVerifyingPin ? "Verifying..." : "View payslips"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">My Payslips</h1>
          <div className="flex items-center gap-2">
            {!requiresPin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSetPinOpen(true)}
                  className="text-gray-600"
                >
                  <KeyRound className="h-4 w-4 mr-1" />
                  Set PIN
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSetPdfPasswordOpen(true)}
                  className="text-gray-600"
                >
                  <KeyRound className="h-4 w-4 mr-1" />
                  {payslipPdfPasswordState?.hasCustomPassword
                    ? "Change PDF Password"
                    : "Set PDF Password"}
                </Button>
              </>
            )}
            {requiresPin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPinVerified(false);
                  setPinValue("");
                  setPinError("");
                }}
                className="text-gray-500"
              >
                <Lock className="h-4 w-4 mr-1" />
                Lock
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Payslip History</CardTitle>
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <Label htmlFor="month-filter" className="text-sm">
                    Month:
                  </Label>
                  <Select
                    value={selectedMonth ? selectedMonth : undefined}
                    onValueChange={(v) =>
                      setSelectedMonth(v === ALL_MONTHS_VALUE ? "" : v)
                    }
                  >
                    <SelectTrigger id="month-filter" className="w-40">
                      <SelectValue placeholder="All months" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_MONTHS_VALUE}>All months</SelectItem>
                      {availableMonths.map((month) => {
                        const [year, monthNum] = month.split("-");
                        const date = new Date(
                          parseInt(year),
                          parseInt(monthNum) - 1,
                        );
                        return (
                          <SelectItem key={month} value={month}>
                            {format(date, "MMMM yyyy")}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="cutoff-filter" className="text-sm">
                    Cutoff:
                  </Label>
                  <Select
                    value={selectedCutoff ? selectedCutoff : undefined}
                    onValueChange={(v) =>
                      setSelectedCutoff(v === ALL_CUTOFFS_VALUE ? "" : v)
                    }
                  >
                    <SelectTrigger id="cutoff-filter" className="w-48">
                      <SelectValue placeholder="All cutoffs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CUTOFFS_VALUE}>All cutoffs</SelectItem>
                      {availableCutoffs.map((cutoff) => (
                        <SelectItem key={cutoff} value={cutoff}>
                          {cutoff}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredPayslips?.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Receipt className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>
                  {payslips?.length === 0
                    ? "No payslips available yet"
                    : "No payslips match the selected filters"}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="w-10 px-0 text-center">
                      <span className="sr-only">Show or hide pay amounts</span>
                    </TableHead>
                    <TableHead>Gross Pay</TableHead>
                    <TableHead>Deductions</TableHead>
                    <TableHead>Net Pay</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayslips?.map((payslip: any) => {
                    const rowId = String(payslip._id);
                    const showAmounts = revealedAmountRowIds.has(rowId);
                    const grossStr = formatPesoAmounts(payslip.grossPay);
                    const dedTotal = (payslip.deductions ?? []).reduce(
                      (sum: number, d: { amount?: number }) =>
                        sum + (d.amount || 0),
                      0,
                    );
                    const dedStr = formatPesoAmounts(dedTotal);
                    const netStr = formatPesoAmounts(payslip.netPay);
                    return (
                    <TableRow key={payslip._id}>
                      <TableCell className="font-medium">
                        {payslip.period}
                      </TableCell>
                      <TableCell className="w-10 px-0 text-center align-middle">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-pressed={showAmounts}
                          aria-label={
                            showAmounts
                              ? "Hide pay amounts for this row"
                              : "Show pay amounts for this row"
                          }
                          onClick={() => toggleRowAmountVisibility(rowId)}
                        >
                          {showAmounts ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        ₱
                        {showAmounts
                          ? grossStr
                          : maskPesoNumberPart(grossStr)}
                      </TableCell>
                      <TableCell>
                        ₱{showAmounts ? dedStr : maskPesoNumberPart(dedStr)}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ₱{showAmounts ? netStr : maskPesoNumberPart(netStr)}
                      </TableCell>
                      <TableCell>
                        {format(new Date(payslip.createdAt), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewPayslip(payslip)}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenComment(payslip)}
                          >
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Comment/Appeal
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingPayslipId === payslip._id}
                            onClick={() => void handleDownloadPayslipPdf(payslip)}
                          >
                            {downloadingPayslipId === payslip._id ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4 mr-2" />
                            )}
                            Download
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Payslip Detail Dialog */}
        <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Payslip - {selectedPayslipPeriodTitle}</DialogTitle>
            </DialogHeader>
            {isLoadingDetails ? (
              <div className="py-8 text-center">Loading payslip...</div>
            ) : payslipDetails && employee ? (
              <>
                <PayslipDetail
                  payslip={payslipDetails}
                  employee={employee}
                  organization={organization}
                  cutoffStart={selectedPayslip?.cutoffStart}
                  cutoffEnd={selectedPayslip?.cutoffEnd}
                />
                <DialogFooter className="flex flex-row flex-wrap gap-2 sm:justify-end sm:space-x-0">
                  <Button
                    variant="outline"
                    disabled={
                      !selectedPayslip?._id ||
                      downloadingPayslipId === String(selectedPayslip._id)
                    }
                    onClick={() =>
                      selectedPayslip &&
                      void handleDownloadPayslipPdf(selectedPayslip)
                    }
                  >
                    {downloadingPayslipId === String(selectedPayslip?._id) ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsViewOpen(false);
                      handleOpenComment(selectedPayslip);
                    }}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Comment/Appeal
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <div className="py-8 text-center text-gray-500">
                Unable to load payslip details
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Comment/Appeal Dialog */}
        <Dialog open={isCommentOpen} onOpenChange={setIsCommentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Comment/Appeal on Payslip</DialogTitle>
              <DialogDescription>
                Send a comment or appeal about payslip:{" "}
                {selectedPayslip?.period}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {appealRecipient === null && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  No payroll contact is set up yet. Add someone with owner,
                  admin, or HR access to this organization, then try again.
                  Messages are delivered to their Chat inbox.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="comment">Your Comment/Appeal</Label>
                <Textarea
                  id="comment"
                  placeholder="Please describe your concern or question about this payslip..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={6}
                  disabled={appealRecipient !== undefined && !appealRecipient}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsCommentOpen(false);
                  setCommentText("");
                }}
                disabled={isSendingComment}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSendComment}
                disabled={
                  !commentText.trim() ||
                  isSendingComment ||
                  !appealRecipient?.userId
                }
              >
                {isSendingComment ? "Sending..." : "Send Comment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Set payslip PIN dialog */}
        <Dialog open={isSetPinOpen} onOpenChange={setIsSetPinOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set payslip PIN</DialogTitle>
              <DialogDescription>
                Create a PIN (at least 4 characters) to protect access to your
                payslips. You will need this PIN each time you open the payslips
                page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="set-pin">PIN</Label>
                <Input
                  id="set-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="At least 4 characters"
                  value={pinToSet}
                  onChange={(e) =>
                    setPinToSet(e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="set-pin-confirm">Confirm PIN</Label>
                <Input
                  id="set-pin-confirm"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Confirm PIN"
                  value={pinConfirm}
                  onChange={(e) =>
                    setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSetPinOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSetPin}
                disabled={
                  isSettingPin || pinToSet.length < 4 || pinToSet !== pinConfirm
                }
              >
                {isSettingPin ? "Setting..." : "Set PIN"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Set payslip PDF password dialog */}
        <Dialog open={isSetPdfPasswordOpen} onOpenChange={setIsSetPdfPasswordOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Payslip PDF password</DialogTitle>
              <DialogDescription>
                Set a custom password for emailed payslip PDFs. Leave it blank to
                reset to your employee ID.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="pdf-password">New password</Label>
                <Input
                  id="pdf-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 4 characters (optional)"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pdf-password-confirm">Confirm password</Label>
                <Input
                  id="pdf-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirm password"
                  value={pdfPasswordConfirm}
                  onChange={(e) => setPdfPasswordConfirm(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsSetPdfPasswordOpen(false)}
                disabled={isSettingPdfPassword}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSetPdfPassword}
                disabled={isSettingPdfPassword || pdfPassword.trim() !== pdfPasswordConfirm.trim()}
              >
                {isSettingPdfPassword ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}

export default function PayslipsPage() {
  return (
    <Suspense
      fallback={
        <MainLayout>
          <div className="flex min-h-[200px] items-center justify-center p-8 text-gray-500">
            Loading…
          </div>
        </MainLayout>
      }
    >
      <PayslipsPageContent />
    </Suspense>
  );
}
