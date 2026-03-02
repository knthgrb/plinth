"use client";

import React, { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, UserPlus, Mail, X, Send } from "lucide-react";
import { useMutation } from "convex/react";
import { format } from "date-fns";
import {
  updateOrganization,
  addUserToOrganization,
  removeUserFromOrganization,
  updateUserRoleInOrganization,
  deleteOrganization,
} from "@/actions/organizations";
import { resendInvitation } from "@/actions/invitations";
import { CreateOrganizationDialog } from "@/components/create-organization-dialog";
import { useToast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";

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
  const [inviteFormData, setInviteFormData] = useState({
    email: "",
    role: "employee" as "admin" | "hr" | "accounting" | "employee",
  });
  const [resendingId, setResendingId] = useState<string | null>(null);

  const members = useQuery(
    (api as any).organizations.getOrganizationMembers,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

  const invitations = useQuery(
    (api as any).invitations.getInvitations,
    currentOrganizationId ? { organizationId: currentOrganizationId } : "skip",
  );

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
      alert(error.message || "Failed to update organization");
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganizationId || !isOwnerOrAdmin) return;

    try {
      await addUserToOrganization({
        organizationId: currentOrganizationId,
        email: inviteFormData.email,
        role: inviteFormData.role,
      });
      setIsInviteDialogOpen(false);
      setInviteFormData({ email: "", role: "employee" });
      // Refresh will happen automatically via useQuery
    } catch (error: any) {
      alert(error.message || "Failed to add user");
    }
  };

  const handleRemoveUser = async (userId: string) => {
    if (!currentOrganizationId || !isOwnerOrAdmin) return;
    if (!confirm("Are you sure you want to remove this user?")) return;

    try {
      await removeUserFromOrganization(currentOrganizationId, userId);
    } catch (error: any) {
      alert(error.message || "Failed to remove user");
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
      alert(error.message || "Failed to update role");
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
      alert(error.message || "Failed to delete organization");
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
              {isOwnerOrAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsInviteDialogOpen(true)}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add User
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
                  {members?.map((member: any) => {
                    const isCurrentUser = member._id === currentUserId;
                    const canEditThisRole =
                      canEditMemberRoles && !isCurrentUser;
                    return (
                      <TableRow key={member._id}>
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

        {canViewMembers && invitations && invitations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Invitations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {invitations
                  .filter((inv: any) => inv.status === "pending")
                  .map((invitation: any) => (
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
                            try {
                              await resendInvitation(invitation._id);
                              toast({
                                title: "Invitation resent",
                                description: `Email sent again to ${invitation.email}.`,
                              });
                            } catch (error: any) {
                              toast({
                                title: "Failed to resend",
                                description: error.message || "Failed to resend invitation.",
                                variant: "destructive",
                              });
                            } finally {
                              setResendingId(null);
                            }
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
                              alert(
                                error.message || "Failed to cancel invitation",
                              );
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

      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Invitation</DialogTitle>
            <DialogDescription>
              Send an email invitation to join this organization. The user will
              receive an email with a link to accept the invitation.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInviteUser}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email <span className="text-red-500">*</span></Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteFormData.email}
                  onChange={(e) =>
                    setInviteFormData({
                      ...inviteFormData,
                      email: e.target.value,
                    })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role <span className="text-red-500">*</span></Label>
                <Select
                  value={inviteFormData.role}
                  onValueChange={(value: any) =>
                    setInviteFormData({ ...inviteFormData, role: value })
                  }
                >
                  <SelectTrigger>
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
              <Button type="submit">Send Invitation</Button>
            </DialogFooter>
          </form>
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
