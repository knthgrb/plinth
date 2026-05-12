"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrganization } from "@/hooks/organization-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, UserPlus, Mail, X, Send } from "lucide-react";
import { useMutation } from "convex/react";
import { format } from "date-fns";
import {
  updateOrganization,
  removeUserFromOrganization,
  updateUserRoleInOrganization,
  deleteOrganization,
} from "@/actions/organizations";
import {
  resendInvitation,
  batchCreateInvitations,
  type BatchCreateInvitationsItem,
} from "@/actions/invitations";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";
import { useToast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";

type InviteableEmployeeRow = {
  _id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  email: string;
};

function normalizeInviteEmailUi(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmailFormat(email: string): boolean {
  const t = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export function OrganizationManagement(): React.ReactElement {
  const {
    currentOrganizationId,
    organizations,
    currentOrganization,
    refreshOrganizations,
  } = useOrganization();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    taxId: "",
  });
  const [inviteRoleOnly, setInviteRoleOnly] = useState<
    "admin" | "hr" | "accounting" | "employee"
  >("employee");
  const [manualInviteEmailDraft, setManualInviteEmailDraft] = useState("");
  const [manualInviteEmails, setManualInviteEmails] = useState<string[]>([]);
  const [selectedInviteEmployeeIds, setSelectedInviteEmployeeIds] = useState<
    string[]
  >([]);
  const [employeeInvitePickerOpen, setEmployeeInvitePickerOpen] =
    useState(false);
  const [pendingBatchInviteItems, setPendingBatchInviteItems] = useState<
    BatchCreateInvitationsItem[]
  >([]);
  const [batchConfirmEmails, setBatchConfirmEmails] = useState<string[]>([]);
  const [isInviteExistingUserDialogOpen, setIsInviteExistingUserDialogOpen] =
    useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const inviteableEmployees = useQuery(
    (api as any).employees.listEmployeesAvailableForOrgInvite,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  ) as InviteableEmployeeRow[] | undefined;

  const members = useQuery(
    (api as any).organizations.getOrganizationMembers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const invitations = useQuery(
    (api as any).invitations.getInvitations,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const pendingInvitationsToShow = useMemo(() => {
    if (!invitations) return [];
    return invitations.filter(
      (inv: { status: string; pendingNeedsAction?: boolean }) =>
        inv.status === "pending" && inv.pendingNeedsAction !== false,
    );
  }, [invitations]);

  const cancelInvitationMutation = useMutation(
    (api as any).invitations.cancelInvitation,
  );

  const currentUser = useQuery(
    (api as any).organizations.getCurrentUser,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );
  const currentUserId = (currentUser as any)?._id ?? null;

  const { toast } = useToast();
  // API can return "owner"; context type may omit it
  const role = currentOrganization?.role as
    | "admin"
    | "owner"
    | "hr"
    | "employee"
    | "accounting"
    | undefined;
  const isAdmin = role === "admin";
  const isOwner = role === "owner";
  const isOwnerOrAdmin = role === "admin" || role === "owner";
  /** Only owner, admin, and HR can edit org info/settings */
  const canEditOrgInfo =
    role === "owner" || role === "admin" || role === "hr";
  /** Only owner, admin, and HR can edit other members' roles (never own role) */
  const canEditMemberRoles =
    role === "owner" || role === "admin" || role === "hr";
  /** Owner, admin, HR, accounting can see members list */
  const canViewMembers =
    role === "admin" || role === "accounting" || role === "owner" || role === "hr";
  const canInviteUsers =
    role === "owner" || role === "admin" || role === "hr";

  const handleEditOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !canEditOrgInfo) return;

    try {
      await updateOrganization(currentOrganizationId, {
        name: editFormData.name || undefined,
        address: editFormData.address || undefined,
        phone: editFormData.phone || undefined,
        email: editFormData.email || undefined,
        taxId: editFormData.taxId || undefined,
      });
      setIsEditDialogOpen(false);
      setEditFormData({
        name: "",
        address: "",
        phone: "",
        email: "",
        taxId: "",
      });
      refreshOrganizations();
    } catch (error: any) {
      toast({
        title: "Could not save organization",
        description: error.message || "Failed to update organization",
        variant: "destructive",
      });
    }
  };

  const buildInviteBatchItems = (): BatchCreateInvitationsItem[] => {
    const seen = new Set<string>();
    const items: BatchCreateInvitationsItem[] = [];
    for (const id of selectedInviteEmployeeIds) {
      const row = inviteableEmployees?.find((e) => e._id === id);
      if (!row?.email) continue;
      const n = normalizeInviteEmailUi(row.email);
      if (seen.has(n)) continue;
      seen.add(n);
      items.push({ email: row.email.trim(), employeeId: id });
    }
    for (const em of manualInviteEmails) {
      const trimmed = em.trim();
      if (!trimmed) continue;
      const n = normalizeInviteEmailUi(trimmed);
      if (seen.has(n)) continue;
      seen.add(n);
      items.push({ email: trimmed });
    }
    return items;
  };

  const resetInviteDialogState = () => {
    setManualInviteEmailDraft("");
    setManualInviteEmails([]);
    setSelectedInviteEmployeeIds([]);
    setInviteRoleOnly("employee");
    setPendingBatchInviteItems([]);
    setBatchConfirmEmails([]);
  };

  const runBatchInvites = async (
    items: BatchCreateInvitationsItem[],
    confirmInviteToExistingPlinthUser?: boolean,
  ): Promise<void> => {
    if (!currentOrganizationId || !canInviteUsers) return;
    if (items.length === 0) {
      toast({
        title: "Add recipients",
        description:
          "Select employees and/or add at least one email address to invite.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingInvite(true);
    try {
      const result = await batchCreateInvitations({
        organizationId: currentOrganizationId,
        role: inviteRoleOnly,
        items,
        confirmInviteToExistingPlinthUser,
      });
      if (!result.ok) {
        toast({
          title: "Invitation failed",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      if (
        result.needsConfirmForEmails.length > 0 &&
        !confirmInviteToExistingPlinthUser
      ) {
        setPendingBatchInviteItems(items);
        setBatchConfirmEmails(result.needsConfirmForEmails);
        setIsInviteExistingUserDialogOpen(true);
        if (result.createdInvitationIds.length > 0) {
          toast({
            title: "Partial invitations sent",
            description: `${result.createdInvitationIds.length} invitation(s) sent. Confirm to send to ${result.needsConfirmForEmails.length} address(es) that already have a Plinth account.`,
          });
        }
        return;
      }

      const nSent = result.createdInvitationIds.length;
      const nSkip = result.skipped.length;
      if (nSent > 0) {
        toast({
          title: nSent === 1 ? "Invitation sent" : "Invitations sent",
          description:
            nSkip > 0
              ? `Emailed ${nSent} recipient(s). ${nSkip} skipped (already invited or ineligible).`
              : `Emailed ${nSent} recipient(s) with a link to join this organization.`,
        });
      } else if (nSkip > 0) {
        toast({
          title: "No new invitations",
          description: result.skipped
            .map((s) => `${s.email}: ${s.reason}`)
            .slice(0, 4)
            .join(" · "),
          variant: "destructive",
        });
        return;
      }

      setIsInviteExistingUserDialogOpen(false);
      setIsInviteDialogOpen(false);
      resetInviteDialogState();
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleInviteFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runBatchInvites(buildInviteBatchItems());
  };

  const handleConfirmBatchInviteExistingUsers = async () => {
    if (pendingBatchInviteItems.length === 0) return;
    await runBatchInvites(pendingBatchInviteItems, true);
  };

  const handleAddManualInviteEmail = () => {
    const raw = manualInviteEmailDraft.trim();
    if (!raw) return;
    if (!isValidEmailFormat(raw)) {
      toast({
        title: "Invalid email",
        description: "Enter a valid email address.",
        variant: "destructive",
      });
      return;
    }
    const norm = normalizeInviteEmailUi(raw);
    if (
      manualInviteEmails.some((e) => normalizeInviteEmailUi(e) === norm) ||
      selectedInviteEmployeeIds.some((id) => {
        const row = inviteableEmployees?.find((e) => e._id === id);
        return row && normalizeInviteEmailUi(row.email) === norm;
      })
    ) {
      toast({
        title: "Already in list",
        description: "This address is already included.",
        variant: "destructive",
      });
      return;
    }
    setManualInviteEmails((prev) => [...prev, raw]);
    setManualInviteEmailDraft("");
  };

  const toggleInviteEmployee = (employeeId: string) => {
    setSelectedInviteEmployeeIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );
  };

  const handleRemoveUser = async (userId: string) => {
    if (!currentOrganizationId || !isOwnerOrAdmin) return;
    if (!confirm("Are you sure you want to remove this user?")) return;

    try {
      await removeUserFromOrganization(currentOrganizationId, userId);
    } catch (error: any) {
      toast({
        title: "Could not remove user",
        description: error.message || "Failed to remove user",
        variant: "destructive",
      });
    }
  };

  const handleUpdateRole = async (
    userId: string,
    newRole: "admin" | "hr" | "accounting" | "employee",
  ) => {
    if (!currentOrganizationId || !canEditMemberRoles) return;
    if (userId === currentUserId) return; // User cannot edit their own role

    try {
      await updateUserRoleInOrganization({
        organizationId: currentOrganizationId,
        userId,
        role: newRole,
      });
    } catch (error: any) {
      toast({
        title: "Could not update role",
        description: error.message || "Failed to update role",
        variant: "destructive",
      });
    }
  };

  const handleDeleteOrganization = async () => {
    if (!currentOrganizationId || !isOwner) return;
    setIsDeleting(true);

    try {
      await deleteOrganization(currentOrganizationId);
      setIsDeleteDialogOpen(false);
      // Redirect to first available organization or dashboard
      if (organizations.length > 1) {
        const remainingOrg = organizations.find(
          (org) => org._id !== currentOrganizationId,
        );
        if (remainingOrg) {
          window.location.href = `/${remainingOrg._id}/dashboard`;
        } else {
          window.location.href = "/dashboard";
        }
      } else {
        window.location.href = "/dashboard";
      }
    } catch (error: any) {
      toast({
        title: "Could not delete organization",
        description: error.message || "Failed to delete organization",
        variant: "destructive",
      });
      setIsDeleting(false);
    }
  };

  const currentOrgDetails = organizations.find(
    (o) => o._id === currentOrganizationId,
  );

  const openEditDialog = () => {
    if (currentOrgDetails) {
      setEditFormData({
        name: currentOrgDetails.name || "",
        address: (currentOrgDetails as any)?.address || "",
        phone: (currentOrgDetails as any)?.phone || "",
        email: (currentOrgDetails as any)?.email || "",
        taxId: (currentOrgDetails as any)?.taxId || "",
      });
      setIsEditDialogOpen(true);
    }
  };

  if (!currentOrganizationId) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-gray-500 mb-4">No organization selected</p>
          <Button onClick={() => {}}>
            <Plus className="mr-2 h-4 w-4" />
            Create Organization
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Organization Details</CardTitle>
            <div className="flex items-center gap-2">
              {canEditOrgInfo && (
                <Button variant="outline" size="sm" onClick={openEditDialog}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-gray-500">Name</div>
              <div className="text-lg">{currentOrganization?.name || "-"}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-gray-500">Email</div>
                <div className="text-lg">
                  {(currentOrgDetails as any)?.email || "-"}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-500">Phone</div>
                <div className="text-lg">
                  {(currentOrgDetails as any)?.phone || "-"}
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Address</div>
              <div className="text-lg">
                {(currentOrgDetails as any)?.address || "-"}
              </div>
            </div>
          </CardContent>
        </Card>

        {canViewMembers && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Organization Members</CardTitle>
              {canInviteUsers && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsInviteDialogOpen(true)}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite user
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members?.map((member: any, index: number) => {
                    const isCurrentUser = member._id === currentUserId;
                    const canEditThisRole =
                      canEditMemberRoles && !isCurrentUser;
                    return (
                      <TableRow
                        key={member._id ?? member.email ?? `member-${index}`}
                      >
                        <TableCell>{member.name || "-"}</TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>
                          {isCurrentUser ? (
                            <span className="capitalize">
                              {member.role === "owner"
                                ? "Owner"
                                : (member.role ?? "").charAt(0).toUpperCase() +
                                  (member.role ?? "").slice(1)}
                            </span>
                          ) : (
                            <Select
                              value={member.role}
                              onValueChange={(value: any) =>
                                handleUpdateRole(member._id, value)
                              }
                              disabled={!canEditThisRole}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="hr">HR</SelectItem>
                                <SelectItem value="accounting">
                                  Accounting
                                </SelectItem>
                                <SelectItem value="employee">
                                  Employee
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isOwnerOrAdmin && !isCurrentUser && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveUser(member._id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {canViewMembers && pendingInvitationsToShow.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pendingInvitationsToShow.map((invitation: any) => (
                    <div
                      key={invitation._id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <div>
                          <div className="font-medium">{invitation.email}</div>
                          <div className="text-sm text-gray-500">
                            Invited as {invitation.role} •{" "}
                            {format(
                              new Date(invitation.createdAt),
                              "MMM dd, yyyy",
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Pending</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resendingId === invitation._id}
                          onClick={async () => {
                            setResendingId(invitation._id);
                            const result = await resendInvitation(invitation._id);
                            if (!result.ok) {
                              toast({
                                title: "Failed to resend",
                                description: result.error,
                                variant: "destructive",
                              });
                            } else {
                              toast({
                                title: "Invitation resent",
                                description: `Email sent again to ${invitation.email}.`,
                              });
                            }
                            setResendingId(null);
                          }}
                          title="Resend invitation email"
                        >
                          {resendingId === invitation._id ? (
                            <Spinner size="sm" className="border-gray-600 border-t-transparent" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await cancelInvitationMutation({
                                invitationId: invitation._id,
                              });
                            } catch (error: any) {
                              toast({
                                title: "Could not cancel invitation",
                                description:
                                  error.message || "Failed to cancel invitation",
                                variant: "destructive",
                              });
                            }
                          }}
                          title="Cancel invitation"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update organization information
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditOrganization}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Organization Name <span className="text-red-500">*</span></Label>
                <Input
                  id="edit-name"
                  value={editFormData.name}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editFormData.email}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={editFormData.phone}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-address">Address</Label>
                <Input
                  id="edit-address"
                  value={editFormData.address}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      address: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-taxId">Tax ID</Label>
                <Input
                  id="edit-taxId"
                  value={editFormData.taxId}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, taxId: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isInviteDialogOpen}
        onOpenChange={(open) => {
          setIsInviteDialogOpen(open);
          if (!open) {
            resetInviteDialogState();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite users</DialogTitle>
            <DialogDescription>
              Choose employees without an org account yet and/or add email
              addresses, then send invitations in one batch.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleInviteFormSubmit(e)}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Employees (not in organization yet)</Label>
                <Popover
                  open={employeeInvitePickerOpen}
                  onOpenChange={setEmployeeInvitePickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start font-normal"
                    >
                      {selectedInviteEmployeeIds.length === 0
                        ? "Select employees…"
                        : `${selectedInviteEmployeeIds.length} selected`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0 max-h-72 overflow-y-auto"
                    align="start"
                  >
                    {!inviteableEmployees || inviteableEmployees.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-3">
                        No employees are available to invite (everyone with a
                        record may already be a member or invited).
                      </p>
                    ) : (
                      <ul className="py-1">
                        {inviteableEmployees.map((emp) => {
                          const label = [emp.firstName, emp.middleName, emp.lastName]
                            .filter(Boolean)
                            .join(" ");
                          const checked = selectedInviteEmployeeIds.includes(
                            emp._id,
                          );
                          return (
                            <li key={emp._id}>
                              <label className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 text-sm">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() =>
                                    toggleInviteEmployee(emp._id)
                                  }
                                  className="mt-0.5"
                                />
                                <span className="min-w-0">
                                  <span className="font-medium block truncate">
                                    {label}
                                  </span>
                                  <span className="text-muted-foreground text-xs break-all">
                                    {emp.email}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-email-manual">Email addresses</Label>
                <div className="flex gap-2">
                  <Input
                    id="invite-email-manual"
                    type="email"
                    placeholder="name@company.com"
                    value={manualInviteEmailDraft}
                    onChange={(e) =>
                      setManualInviteEmailDraft(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddManualInviteEmail();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddManualInviteEmail}
                  >
                    Add
                  </Button>
                </div>
                {manualInviteEmails.length > 0 && (
                  <ul className="flex flex-wrap gap-2 pt-1">
                    {manualInviteEmails.map((em) => (
                      <li
                        key={em}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-sm"
                      >
                        <span className="max-w-[220px] truncate">{em}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground p-0.5"
                          onClick={() =>
                            setManualInviteEmails((prev) =>
                              prev.filter((x) => x !== em),
                            )
                          }
                          aria-label={`Remove ${em}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role-batch">
                  Role <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={inviteRoleOnly}
                  onValueChange={(value: "admin" | "hr" | "accounting" | "employee") =>
                    setInviteRoleOnly(value)
                  }
                >
                  <SelectTrigger id="invite-role-batch">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="accounting">Accounting</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsInviteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSendingInvite}>
                {isSendingInvite ? "Sending…" : "Send invitations"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isInviteExistingUserDialogOpen}
        onOpenChange={(open) => {
          setIsInviteExistingUserDialogOpen(open);
          if (!open) {
            setBatchConfirmEmails([]);
            setPendingBatchInviteItems([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Existing Plinth account(s)</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  The following {batchConfirmEmails.length === 1 ? "address is" : "addresses are"}{" "}
                  already registered on Plinth. They will be asked to log in to
                  accept; no new account will be created.
                </p>
                <ul className="list-disc pl-5 space-y-1 text-foreground">
                  {batchConfirmEmails.map((em) => (
                    <li key={em}>{em}</li>
                  ))}
                </ul>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsInviteExistingUserDialogOpen(false);
                setBatchConfirmEmails([]);
                setPendingBatchInviteItems([]);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmBatchInviteExistingUsers()}
              disabled={isSendingInvite}
            >
              {isSendingInvite ? "Sending…" : "Confirm and send invitations"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Organization</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{currentOrganization?.name}"?
              This action cannot be undone. All members will be removed from
              this organization, but employee and payroll records will be
              preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteOrganization}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
