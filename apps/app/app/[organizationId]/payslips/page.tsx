"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Receipt,
  Download,
  Eye,
  MessageSquare,
  Filter,
  Lock,
  KeyRound,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, parse } from "date-fns";
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
import { getPayslip } from "@/actions/payroll";
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
import { payslipPinSessionKey } from "@/lib/payslip-session";

function PayslipsPageContent() {
  const { toast } = useToast();
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

  const handleViewPayslip = async (payslip: any) => {
    setSelectedPayslip(payslip);
    setIsViewOpen(true);
    setIsLoadingDetails(true);
    try {
      const details = await getPayslip(payslip._id);
      setPayslipDetails(details);
    } catch (error) {
      console.error("Error loading payslip details:", error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // PIN session (shared with global appeal / deep-link modal)
  useEffect(() => {
    if (!currentOrganizationId || typeof window === "undefined") return;
    if (
      sessionStorage.getItem(
        payslipPinSessionKey(String(currentOrganizationId)),
      ) === "1"
    ) {
      setPinVerified(true);
    }
  }, [currentOrganizationId]);

  const handleOpenComment = (payslip: any) => {
    setSelectedPayslip(payslip);
    setIsCommentOpen(true);
    setCommentText("");
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
        if (currentOrganizationId) {
          sessionStorage.setItem(
            payslipPinSessionKey(String(currentOrganizationId)),
            "1",
          );
        }
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

  if (requiresPin && !pinVerified && !payslipIdFromUrl) {
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
                    <TableHead>Gross Pay</TableHead>
                    <TableHead>Deductions</TableHead>
                    <TableHead>Net Pay</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPayslips?.map((payslip: any) => (
                    <TableRow key={payslip._id}>
                      <TableCell className="font-medium">
                        {payslip.period}
                      </TableCell>
                      <TableCell>
                        ₱
                        {payslip.grossPay?.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }) || "0.00"}
                      </TableCell>
                      <TableCell>
                        ₱
                        {payslip.deductions
                          ?.reduce(
                            (sum: number, d: any) => sum + (d.amount || 0),
                            0,
                          )
                          ?.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }) || "0.00"}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ₱
                        {payslip.netPay?.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }) || "0.00"}
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
                            <Eye className="h-4 w-4 mr-2" />
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
                            onClick={() => {
                              // TODO: Implement PDF download
                              toast({
                                title: "Coming Soon",
                                description:
                                  "PDF download feature will be available soon.",
                              });
                            }}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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
                <DialogFooter>
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
