"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Building2, User, Mail, LogOut } from "lucide-react";

function normEmail(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [currentSessionEmail, setCurrentSessionEmail] = useState<string | null>(
    null
  );
  const [showSwitchAccountDialog, setShowSwitchAccountDialog] = useState(false);
  const [redirectingAfterAccept, setRedirectingAfterAccept] = useState(false);

  const invitation = useQuery(
    (api as any).invitations.getInvitationByToken,
    token ? { token } : "skip"
  );

  const acceptInvitationMutation = useMutation(
    (api as any).invitations.acceptInvitation
  );

  const updateLastActiveOrganizationMutation = useMutation(
    (api as any).organizations.updateLastActiveOrganization
  );

  // Check for existing session when invitation loads
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await authClient.getSession();
        // Better Auth session structure: session.data.user or session.data.session.user
        const userEmail =
          (session?.data as any)?.user?.email ||
          (session?.data as any)?.session?.user?.email;

        if (userEmail) {
          setCurrentSessionEmail(userEmail);
          // Only show switch dialog when logged in as a *different* email (not for same-email)
          if (
            invitation?.email &&
            normEmail(userEmail) !== normEmail(invitation.email)
          ) {
            setShowSwitchAccountDialog(true);
          }
        }
      } catch (error) {
        // No session or error checking session
        setCurrentSessionEmail(null);
      }
    };

    if (invitation?.email) {
      checkSession();
    }
  }, [invitation?.email]);

  const handleSwitchAccount = async () => {
    try {
      await authClient.signOut();
      setCurrentSessionEmail(null);
      setShowSwitchAccountDialog(false);
      setPassword("");
    } catch (error: any) {
      setError(error.message || "Failed to sign out");
    }
  };

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !invitation) return;

    // If there's a different account logged in, require sign out first
    if (
      currentSessionEmail &&
      normEmail(currentSessionEmail) !== normEmail(invitation.email) &&
      !showSwitchAccountDialog
    ) {
      setShowSwitchAccountDialog(true);
      return;
    }

    setError("");
    setIsProcessing(true);

    const isAlreadyLoggedInAsInvitee =
      normEmail(currentSessionEmail) === normEmail(invitation.email);

    try {
      // Already logged in as invitee: just add org and set as active, no password
      if (isAlreadyLoggedInAsInvitee) {
        const result = await acceptInvitationMutation({ token });
        setRedirectingAfterAccept(true);
        if (result?.organizationId) {
          await updateLastActiveOrganizationMutation({
            organizationId: result.organizationId,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
        const role = invitation.role;
        let path = "/dashboard";
        if (role === "accounting") path = "/accounting";
        else if (role === "employee") path = "/announcements";
        const redirectUrl = result?.organizationId
          ? `/${result.organizationId}${path}`
          : path;
        window.location.href = redirectUrl;
        return;
      }

      // Validate password (for not-logged-in or different-account flow)
      if (!password || password.length < 6) {
        setError("Password must be at least 6 characters");
        setIsProcessing(false);
        return;
      }

      if (
        currentSessionEmail &&
        normEmail(currentSessionEmail) !== normEmail(invitation.email)
      ) {
        await authClient.signOut();
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const signInResult = await authClient.signIn.email({
        email: invitation.email,
        password,
      });

      if (signInResult.error) {
        const signUpResult = await authClient.signUp.email({
          email: invitation.email,
          password,
          name:
            (invitation as any).inviteeName ??
            invitation.email.split("@")[0],
        });

        if (signUpResult.error) {
          setError(
            "Unable to continue with this password. Check it or reset your password before trying again.",
          );
          setIsProcessing(false);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Wait for session to propagate (needed for acceptInvitation auth check when email matches)
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Accept invitation - creates user record in Convex if needed, adds to org (no ensureUserRecord needed)
      const result = await acceptInvitationMutation({
        token,
      });

      // Mark as redirecting so we don't show "already been accepted" when the query updates
      setRedirectingAfterAccept(true);

      // Wait for organization context and replication so getCurrentUser/getUserOrganizations see the new org
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Redirect using organization Id so layout/getCurrentUser receive a valid Convex id
      const role = invitation.role;
      let path = "/dashboard";
      if (role === "accounting") {
        path = "/accounting";
      } else if (role === "employee") {
        path = "/announcements";
      }
      const organizationId = result?.organizationId;
      const redirectUrl = organizationId
        ? `/${organizationId}${path}`
        : path;

      window.location.href = redirectUrl;
    } catch (err: any) {
      setError(err.message || "Failed to accept invitation");
      setIsProcessing(false);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <p className="text-center text-red-600">Invalid invitation link</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (invitation === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <p className="text-center text-gray-500">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!invitation || invitation.status !== "pending") {
    // Just accepted and redirecting — don't show "already been accepted"
    if (redirectingAfterAccept) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <Card className="w-full max-w-md">
            <CardContent className="p-6">
              <p className="text-center text-gray-600">
                Invitation accepted. Redirecting...
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <p className="text-center text-red-600">
              {!invitation
                ? "Invitation not found"
                : invitation.status === "accepted"
                  ? "This invitation has already been accepted"
                  : invitation.status === "expired"
                    ? "This invitation has expired"
                    : "This invitation is no longer valid"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
              <Building2 className="h-6 w-6 text-purple-600" />
            </div>
            <CardTitle className="text-2xl">Accept Invitation</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Only show "sign out first" when logged in as a *different* email */}
            {currentSessionEmail &&
              normEmail(currentSessionEmail) !== normEmail(invitation.email) && (
                <div className="mb-4 rounded-lg bg-yellow-50 border border-yellow-200 p-3">
                  <p className="text-sm text-yellow-800">
                    You are currently signed in as{" "}
                    <strong>{currentSessionEmail}</strong>. You need to sign out
                    first to accept this invitation.
                  </p>
                </div>
              )}

            <div className="mb-6 space-y-3 rounded-lg bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">
                  Organization:
                </span>
                <span className="text-sm text-gray-900">
                  {invitation.organization?.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">
                  Email:
                </span>
                <span className="text-sm text-gray-900">
                  {invitation.email}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Role:</span>
                <Badge variant="secondary" className="capitalize">
                  {invitation.role}
                </Badge>
              </div>
              {invitation.inviter && (
                <div className="text-xs text-gray-500">
                  Invited by {invitation.inviter.name}
                </div>
              )}
            </div>

            <form onSubmit={handleAccept} className="space-y-4">
              {currentSessionEmail &&
              normEmail(currentSessionEmail) === normEmail(invitation.email) ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    You're signed in as <strong>{invitation.email}</strong>. Click below to join this organization.
                  </p>
                  {error && (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                      {error}
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={isProcessing}>
                    {isProcessing ? "Processing..." : "Accept invitation"}
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password *</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Enter your password or create one"
                      disabled={
                        !!(
                          currentSessionEmail &&
                          normEmail(currentSessionEmail) !==
                            normEmail(invitation.email)
                        )
                      }
                    />
                    <p className="text-xs text-gray-500">
                      Enter your existing password, or choose one if this is your
                      first Plinth invitation.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      isProcessing ||
                      !password ||
                      !!(
                        currentSessionEmail &&
                        normEmail(currentSessionEmail) !==
                          normEmail(invitation.email)
                      )
                    }
                  >
                    {isProcessing
                      ? "Processing..."
                      : "Continue & Accept Invitation"}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Switch Account Dialog */}
      <Dialog
        open={showSwitchAccountDialog}
        onOpenChange={setShowSwitchAccountDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Account</DialogTitle>
            <DialogDescription>
              You are currently signed in as{" "}
              <strong>{currentSessionEmail}</strong>, but this invitation is for{" "}
              <strong>{invitation.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600">
              To accept this invitation, you need to sign out of your current
              account first. After signing out, you can create a new account or
              sign in with the invited email address.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => window.close()}
            >
              Cancel
            </Button>
            <Button onClick={handleSwitchAccount}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
