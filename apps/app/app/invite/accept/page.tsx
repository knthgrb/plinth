"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { buildInvitationAuthPath } from "@/lib/invitation-auth";
import { Button } from "@/components/ui/button";
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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [currentSessionEmail, setCurrentSessionEmail] = useState<string | null>(
    null
  );
  const [showSwitchAccountDialog, setShowSwitchAccountDialog] = useState(false);
  const [redirectingAfterAccept, setRedirectingAfterAccept] = useState(false);

  const invitation = useQuery(
    api.invitations.getInvitationByToken,
    token ? { token } : "skip"
  );

  const acceptInvitationMutation = useMutation(
    api.invitations.acceptInvitation,
  );

  const updateLastActiveOrganizationMutation = useMutation(
    api.organizations.updateLastActiveOrganization,
  );

  // Check for existing session when invitation loads
  useEffect(() => {
    const checkSession = async () => {
      setIsCheckingSession(true);
      try {
        const session = await authClient.getSession();
        const userEmail = session?.data?.user.email;

        if (userEmail) {
          setCurrentSessionEmail(userEmail);
          // Only show switch dialog when logged in as a *different* email (not for same-email)
          if (
            invitation?.email &&
            normEmail(userEmail) !== normEmail(invitation.email)
          ) {
            setShowSwitchAccountDialog(true);
          }
        } else {
          setCurrentSessionEmail(null);
        }
      } catch {
        setCurrentSessionEmail(null);
      } finally {
        setIsCheckingSession(false);
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
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to sign out"));
    }
  };

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !invitation) return;

    if (normEmail(currentSessionEmail) !== normEmail(invitation.email)) {
      setError("Sign in with the invited email address before accepting.");
      return;
    }

    setError("");
    setIsProcessing(true);

    try {
      const result = await acceptInvitationMutation({
        token,
      });

      // Mark as redirecting so we don't show "already been accepted" when the query updates
      setRedirectingAfterAccept(true);

      if (result?.organizationId) {
        await updateLastActiveOrganizationMutation({
          organizationId: result.organizationId,
        });
      }

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
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to accept invitation"));
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

  const signInPath = buildInvitationAuthPath("login", {
    email: invitation.email,
    token,
  });
  const signUpPath = buildInvitationAuthPath("signup", {
    email: invitation.email,
    token,
  });
  const isSignedInAsInvitee =
    normEmail(currentSessionEmail) === normEmail(invitation.email);
  const isSignedInAsDifferentUser =
    Boolean(currentSessionEmail) && !isSignedInAsInvitee;

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

            {isCheckingSession ? (
              <p className="text-center text-sm text-muted-foreground">
                Checking your account...
              </p>
            ) : isSignedInAsInvitee ? (
              <form onSubmit={handleAccept} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Signed in as <strong>{invitation.email}</strong>. Click below
                  to join this organization.
                </p>
                {error && (
                  <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isProcessing}
                >
                  {isProcessing ? "Processing..." : "Accept invitation"}
                </Button>
              </form>
            ) : isSignedInAsDifferentUser ? (
              <div className="space-y-4">
                {error && (
                  <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                    {error}
                  </div>
                )}
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => setShowSwitchAccountDialog(true)}
                >
                  Switch account
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Sign in if you already have a Plinth account, or create one
                  using the invited email address.
                </p>
                <Button asChild className="w-full">
                  <Link href={signInPath}>Sign in</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href={signUpPath}>Create account</Link>
                </Button>
                {error && (
                  <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                    {error}
                  </div>
                )}
              </div>
            )}
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
