"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
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

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [isExistingUser, setIsExistingUser] = useState<boolean | null>(null);
  const [currentSessionEmail, setCurrentSessionEmail] = useState<string | null>(
    null
  );
  const [showSwitchAccountDialog, setShowSwitchAccountDialog] = useState(false);
  const [redirectingAfterAccept, setRedirectingAfterAccept] = useState(false);

  const invitation = useQuery(
    (api as any).invitations.getInvitationByToken,
    token ? { token } : "skip"
  );

  const checkUserExists = useQuery(
    (api as any).invitations.checkUserExists,
    invitation?.email ? { email: invitation.email } : "skip"
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
          if (invitation?.email && userEmail.toLowerCase() !== invitation.email.toLowerCase()) {
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

  // Check if user exists when invitation loads
  useEffect(() => {
    if (checkUserExists !== undefined) {
      setIsExistingUser(checkUserExists);
    }
  }, [checkUserExists]);

  const handleSwitchAccount = async () => {
    try {
      await authClient.signOut();
      setCurrentSessionEmail(null);
      setShowSwitchAccountDialog(false);
      // Clear form
      setPassword("");
      setConfirmPassword("");
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
      currentSessionEmail !== invitation.email &&
      !showSwitchAccountDialog
    ) {
      setShowSwitchAccountDialog(true);
      return;
    }

    setError("");
    setIsProcessing(true);

    const isAlreadyLoggedInAsInvitee =
      currentSessionEmail?.toLowerCase() === invitation.email?.toLowerCase();

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

      // If new user, require password confirmation
      if (!isExistingUser) {
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setIsProcessing(false);
          return;
        }
      }

      // If user doesn't exist, create account first (name comes from employee record)
      if (!isExistingUser) {
        const signUpResult = await authClient.signUp.email({
          email: invitation.email,
          password,
          name: (invitation as any).inviteeName ?? invitation.email.split("@")[0],
        });

        if (signUpResult.error) {
          setError(signUpResult.error.message || "Failed to create account");
          setIsProcessing(false);
          return;
        }

        // Wait for Better Auth to complete
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        // User exists in Convex database, but may not have Better Auth account yet
        // If there's a different session, sign out first
        if (currentSessionEmail && currentSessionEmail !== invitation.email) {
          await authClient.signOut();
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        // Try to sign in first (user may already have an account)
        const signInResult = await authClient.signIn.email({
          email: invitation.email,
          password,
        });

        if (signInResult.error) {
          // Sign in failed - could be:
          // 1. User doesn't have Better Auth account yet (first time setting password)
          // 2. Wrong password

          // Try to create account - this will work if they don't have Better Auth account
          // If they do have an account, this will fail and we know password is wrong
          const signUpResult = await authClient.signUp.email({
            email: invitation.email,
            password,
            name: (invitation as any).inviteeName ?? invitation.email.split("@")[0],
          });

          if (signUpResult.error) {
            // Signup failed - user likely has an account but password is wrong
            // Check if error is about existing account
            if (
              signUpResult.error.message?.toLowerCase().includes("already") ||
              signUpResult.error.message?.toLowerCase().includes("exists")
            ) {
              setError(
                "An account with this email already exists. Please enter your existing password."
              );
            } else {
              setError(
                signUpResult.error.message ||
                  "Invalid password. Please enter your existing password."
              );
            }
            setIsProcessing(false);
            return;
          }

          // Account created successfully - wait for Better Auth to complete
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
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

  // Only wait for invitation query; isExistingUser can resolve after (we treat null as false for form)
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
              currentSessionEmail.toLowerCase() !== invitation.email?.toLowerCase() && (
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
              {currentSessionEmail?.toLowerCase() === invitation.email?.toLowerCase() ? (
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
              ) : !currentSessionEmail && isExistingUser === true ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    An account already exists for <strong>{invitation.email}</strong>. Please log in first to accept this invitation.
                  </p>
                  <Button asChild className="w-full">
                    <Link href={token ? `/login?redirect=${encodeURIComponent(`/invite/accept?token=${token}`)}` : "/login"}>
                      Log in to accept
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      {isExistingUser ? "Password *" : "Create Password *"}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder={
                        isExistingUser
                          ? "Enter your password (or set a new one if first time)"
                          : "Create a password (at least 6 characters)"
                      }
                      disabled={
                        !!(
                          currentSessionEmail &&
                          currentSessionEmail !== invitation.email
                        )
                      }
                    />
                    {isExistingUser ? (
                      <p className="text-xs text-gray-500">
                        If this is your first time, the password you enter will be
                        set as your account password. Otherwise, enter your existing
                        password.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Password must be at least 6 characters long
                      </p>
                    )}
                  </div>

                  {!isExistingUser && (
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm Password <span className="text-red-500">*</span></Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        placeholder="Confirm your password"
                        disabled={
                          !!(
                            currentSessionEmail &&
                            currentSessionEmail !== invitation.email
                          )
                        }
                      />
                    </div>
                  )}

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
                      (!isExistingUser && !confirmPassword) ||
                      !!(
                        currentSessionEmail &&
                        currentSessionEmail !== invitation.email
                      )
                    }
                  >
                    {isProcessing
                      ? "Processing..."
                      : isExistingUser
                        ? "Continue & Accept Invitation"
                        : "Create Account & Accept Invitation"}
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
