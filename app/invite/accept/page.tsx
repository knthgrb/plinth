"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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

/** Convert organization name to URL slug (e.g. "Test Org" -> "test-org") */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export default function AcceptInvitationPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [isExistingUser, setIsExistingUser] = useState<boolean | null>(null);
  const [currentSessionEmail, setCurrentSessionEmail] = useState<string | null>(
    null
  );
  const [showSwitchAccountDialog, setShowSwitchAccountDialog] = useState(false);

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

  const ensureUserRecordMutation = useMutation(
    (api as any).organizations.ensureUserRecord
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

          // If there's a session with a different email, show switch dialog
          if (invitation?.email && userEmail !== invitation.email) {
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
      setName("");
    } catch (error: any) {
      setError(error.message || "Failed to sign out");
    }
  };

  const handleContinueWithCurrentAccount = () => {
    setShowSwitchAccountDialog(false);
    // User wants to continue with current account - they'll need to sign in with invitation email
    setError(
      "Please sign out first, then accept the invitation with the invited email address."
    );
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

    try {
      // Validate password
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

      // If user doesn't exist, create account first
      if (!isExistingUser) {
        const signUpResult = await authClient.signUp.email({
          email: invitation.email,
          password,
          name: name || invitation.email.split("@")[0],
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
            name: name || invitation.email.split("@")[0],
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

      // Wait a bit more to ensure session is fully established
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Ensure user record exists in Convex (creates it if it doesn't exist)
      try {
        await ensureUserRecordMutation({});
      } catch (err) {
        // Ignore errors - user record might already exist
        console.log("User record sync:", err);
      }

      // Accept invitation (this will add user to organization with the role from invitation)
      const result = await acceptInvitationMutation({
        token,
        name: name || undefined,
      });

      // Wait for organization context to update
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Redirect to the org they were added to (use slug from org name, not id), based on role
      const role = invitation.role;
      let path = "/dashboard";
      if (role === "accounting") {
        path = "/accounting";
      } else if (role === "employee") {
        path = "/announcements";
      }
      const orgName = invitation.organization?.name;
      const slug = orgName ? nameToSlug(orgName) : null;
      const organizationId = result?.organizationId;
      const redirectUrl = slug
        ? `/${slug}${path}`
        : organizationId
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

  if (invitation === undefined || isExistingUser === null) {
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
            {currentSessionEmail &&
              currentSessionEmail !== invitation.email && (
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
              {!isExistingUser && (
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    required
                    disabled={
                      !!(
                        currentSessionEmail &&
                        currentSessionEmail !== invitation.email
                      )
                    }
                  />
                  <p className="text-xs text-gray-500">
                    Please enter your full name to create your account
                  </p>
                </div>
              )}

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
                  <Label htmlFor="confirmPassword">Confirm Password *</Label>
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

              {currentSessionEmail &&
                currentSessionEmail !== invitation.email && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSwitchAccount}
                    className="w-full"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out & Continue
                  </Button>
                )}

              <Button
                type="submit"
                className="w-full"
                disabled={
                  isProcessing ||
                  !password ||
                  (!isExistingUser && (!name || !confirmPassword)) ||
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
              onClick={() => setShowSwitchAccountDialog(false)}
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
