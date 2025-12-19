"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt, Download, Eye, MessageSquare, Filter } from "lucide-react";
import { format, startOfMonth, endOfMonth, parse } from "date-fns";
import { useOrganization } from "@/hooks/organization-context";
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
import { getPayslip } from "@/app/actions/payroll";
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
import { getOrCreateConversation } from "@/app/actions/chat";
import { useToast } from "@/components/ui/use-toast";

export default function PayslipsPage() {
  const { toast } = useToast();
  const { currentOrganizationId } = useOrganization();
  const user = useQuery((api as any).organizations.getCurrentUser, {
    organizationId: currentOrganizationId || undefined,
  });
  const organization = useQuery(
    (api as any).organizations.getOrganization,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
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

  // Get employee ID from user
  const employeeId = user?.employeeId || currentOrganization?.employeeId;

  const payslips = useQuery(
    (api as any).payroll.getEmployeePayslips,
    employeeId ? { employeeId } : "skip"
  );

  // Get employee details
  const employee = useQuery(
    (api as any).employees.getEmployee,
    employeeId ? { employeeId } : "skip"
  );

  // Get organization members to find admin/accounting for comments
  const organizationMembers = useQuery(
    (api as any).organizations.getOrganizationMembers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip"
  );

  // Filter payslips by month and cutoff
  const filteredPayslips = useMemo(() => {
    if (!payslips) return [];

    let filtered = [...payslips];

    // Filter by month
    if (selectedMonth) {
      const [year, month] = selectedMonth.split("-");
      const monthStart = startOfMonth(
        new Date(parseInt(year), parseInt(month) - 1)
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
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
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
      // Find admin or accounting user from organization members
      const adminOrAccountingUser = organizationMembers?.find(
        (m: any) => m.role === "admin" || m.role === "accounting"
      );

      if (!adminOrAccountingUser?._id) {
        throw new Error("No admin or accounting user found to send message to");
      }

      // Create or get conversation with admin/accounting user
      const conversationId = await getOrCreateConversation({
        organizationId: currentOrganizationId,
        participantId: adminOrAccountingUser._id,
      });

      // Send message with payslip link
      const { sendMessage } = await import("@/app/actions/chat");
      await sendMessage({
        conversationId,
        content: `Payslip Appeal/Comment for ${selectedPayslip.period}:\n\n${commentText}`,
        payslipId: selectedPayslip._id,
      });

      toast({
        title: "Success",
        description: "Your comment/appeal has been sent to admin/accounting.",
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

  return (
    <MainLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">My Payslips</h1>
          <p className="text-gray-600 mt-2">View and download your payslips</p>
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
                    value={selectedMonth}
                    onValueChange={setSelectedMonth}
                  >
                    <SelectTrigger id="month-filter" className="w-40">
                      <SelectValue placeholder="All months" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All months</SelectItem>
                      {availableMonths.map((month) => {
                        const [year, monthNum] = month.split("-");
                        const date = new Date(
                          parseInt(year),
                          parseInt(monthNum) - 1
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
                    value={selectedCutoff}
                    onValueChange={setSelectedCutoff}
                  >
                    <SelectTrigger id="cutoff-filter" className="w-48">
                      <SelectValue placeholder="All cutoffs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All cutoffs</SelectItem>
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
                        ₱{payslip.grossPay?.toLocaleString() || "0.00"}
                      </TableCell>
                      <TableCell>
                        ₱
                        {payslip.deductions
                          ?.reduce(
                            (sum: number, d: any) => sum + (d.amount || 0),
                            0
                          )
                          ?.toLocaleString() || "0.00"}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ₱{payslip.netPay?.toLocaleString() || "0.00"}
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
              <DialogTitle>Payslip - {selectedPayslip?.period}</DialogTitle>
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
              <div className="space-y-2">
                <Label htmlFor="comment">Your Comment/Appeal</Label>
                <Textarea
                  id="comment"
                  placeholder="Please describe your concern or question about this payslip..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={6}
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
                disabled={!commentText.trim() || isSendingComment}
              >
                {isSendingComment ? "Sending..." : "Send Comment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
