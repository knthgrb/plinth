"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";

type SignupStep = 1 | 2;

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const createOrganization = useMutation(
    (api as any).organizations.createOrganization,
  );
  const ensureUserRecord = useMutation(
    (api as any).organizations.ensureUserRecord,
  );

  // Check if user is already logged in and has no organizations
  const userOrganizations = useQuery(
    (api as any).organizations.getUserOrganizations,
    {},
  );

  const [step, setStep] = useState<SignupStep>(1);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    organizationName: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasCheckedSession, setHasCheckedSession] = useState(false);

  // Check if user is already logged in and needs to complete org setup
  useEffect(() => {
    const checkSessionAndSetup = async () => {
      if (hasCheckedSession) return;

      try {
        const session = await authClient.getSession();
        const userEmail =
          (session?.data as any)?.user?.email ||
          (session?.data as any)?.session?.user?.email;

        if (userEmail) {
          // User is logged in, check if they need to complete setup
          setFormData((prev) => ({ ...prev, email: userEmail }));

          // Check URL param for step - if explicitly set to 2, go there
          const stepParam = searchParams.get("step");
          if (stepParam === "2") {
            // Wait for organizations query to determine if we should stay or redirect
            if (userOrganizations !== undefined) {
              if (userOrganizations && userOrganizations.length > 0) {
                // User already has organizations, redirect to dashboard with organizationId
                const firstOrg = userOrganizations[0];
                router.push(`/${firstOrg._id}/dashboard`);
                return;
              } else {
                // User has no organizations, show step 2
                setStep(2);
                toast({
                  title: "Complete your setup",
                  description:
                    "Please provide your organization details to continue",
                });
              }
              setCheckingSession(false);
              setHasCheckedSession(true);
            }
            // If userOrganizations is still undefined, wait for it
            return;
          }

          // No step param - check organizations to decide
          if (userOrganizations !== undefined) {
            if (!userOrganizations || userOrganizations.length === 0) {
              // User has no organizations, show step 2
              setStep(2);
              toast({
                title: "Complete your setup",
                description:
                  "Please provide your organization details to continue",
              });
            } else {
              // User has organizations, redirect to dashboard with organizationId
              const firstOrg = userOrganizations[0];
              router.push(`/${firstOrg._id}/dashboard`);
              return;
            }
            setCheckingSession(false);
            setHasCheckedSession(true);
          }
        } else {
          // No session - user needs to sign up from step 1
          setCheckingSession(false);
          setHasCheckedSession(true);
        }
      } catch (error) {
        // No session or error - user needs to sign up from step 1
        setCheckingSession(false);
        setHasCheckedSession(true);
      }
    };

    checkSessionAndSetup();
  }, [userOrganizations, searchParams, router, toast, hasCheckedSession]);

  // If checking session, show loading state
  if (checkingSession) {
    return (
      <div className="flex min-h-screen bg-white items-center justify-center">
        <div className="text-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || isProcessing) return;

    setLoading(true);
    setIsProcessing(true);

    try {
      // Create user account with Better Auth
      const signUpResult = await authClient.signUp.email({
        email: formData.email,
        password: formData.password,
        name: formData.email.split("@")[0], // Use email prefix as temporary name
      });

      if (signUpResult.error) {
        toast({
          title: "Sign up failed",
          description: signUpResult.error.message || "Failed to create account",
          variant: "destructive",
        });
        setIsProcessing(false);
        setLoading(false);
        return;
      }

      // Wait for Better Auth to complete and session to be established
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Ensure user record exists in Convex
      let userRecordCreated = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await ensureUserRecord({});
          userRecordCreated = true;
          break;
        } catch (err: any) {
          if (attempt < 2) {
            // Wait before retry
            await new Promise((resolve) =>
              setTimeout(resolve, 500 * (attempt + 1)),
            );
          } else {
            console.error("Failed to create user record after retries:", err);
            toast({
              title: "Warning",
              description:
                "Account created but setup incomplete. Please try signing in.",
              variant: "destructive",
            });
            setIsProcessing(false);
            setLoading(false);
            // Redirect to login after a delay
            setTimeout(() => {
              router.push("/login");
            }, 2000);
            return;
          }
        }
      }

      if (userRecordCreated) {
        // Successfully created user record, proceed to step 2
        setStep(2);
        toast({
          title: "Account created",
          description: "Please provide your organization details",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "An error occurred during signup",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setLoading(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || isProcessing) return;

    setLoading(true);
    setIsProcessing(true);

    try {
      // Get user email from session if not already set
      let emailToUse = formData.email;
      if (!emailToUse) {
        try {
          const session = await authClient.getSession();
          emailToUse =
            (session?.data as any)?.user?.email ||
            (session?.data as any)?.session?.user?.email ||
            "";
        } catch (err) {
          // If no session, user needs to sign up first
          toast({
            title: "Error",
            description: "Please sign up first",
            variant: "destructive",
          });
          setStep(1);
          setIsProcessing(false);
          setLoading(false);
          return;
        }
      }

      // Create organization (this will also create/update the user record)
      await createOrganization({
        name: formData.organizationName,
        email: emailToUse,
      });

      toast({
        title: "Organization created",
        description: "Setting up your workspace...",
      });

      // Wait for organization context to be established and session to sync
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Use window.location for a full page reload to ensure session is established
      // This ensures all context providers are properly initialized
      window.location.href = "/walkthrough/prompt";
    } catch (err: any) {
      toast({
        title: "Error",
        description:
          err.message || "Failed to create organization. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left Side - Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-light tracking-tight text-gray-900">
              {step === 1 ? "Get started" : "Let's add some details"}
            </h1>
            <p className="text-sm text-gray-500">
              {step === 1
                ? "Create your account to get started"
                : "Tell us about your organization"}
            </p>
            {/* Progress indicator */}
            <div className="flex items-center gap-2 pt-2">
              <div
                className={`h-1 flex-1 rounded-full ${
                  step >= 1 ? "bg-brand-purple" : "bg-gray-200"
                }`}
              />
              <div
                className={`h-1 flex-1 rounded-full ${
                  step >= 2 ? "bg-brand-purple" : "bg-gray-200"
                }`}
              />
            </div>
          </div>

          {step === 1 ? (
            <form onSubmit={handleStep1Submit} className="space-y-6">
              <div className="space-y-4">
                <div>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    required
                    className="h-12 border-gray-300 bg-white text-base"
                  />
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    required
                    minLength={8}
                    className="h-12 border-gray-300 bg-white text-base pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="default"
                className="w-full h-12 text-base font-normal"
                disabled={loading || isProcessing}
              >
                {loading ? "Creating account..." : "Continue"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleStep2Submit} className="space-y-6">
              <div>
                <Input
                  id="organizationName"
                  type="text"
                  placeholder="Organization name"
                  value={formData.organizationName}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      organizationName: e.target.value,
                    })
                  }
                  required
                  className="h-12 border-gray-300 bg-white text-base"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1 h-12 text-base font-normal"
                  disabled={loading || isProcessing}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  className="flex-1 h-12 text-base font-normal"
                  disabled={loading || isProcessing}
                >
                  {loading ? "Setting up..." : "Continue"}
                </Button>
              </div>
            </form>
          )}

          <div className="text-center">
            <p className="text-sm text-gray-500">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-brand-purple hover:text-brand-purple-hover font-medium"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Image */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-purple-50 to-purple-100 items-center justify-center p-12">
        <div className="relative w-full h-full max-w-2xl">
          {/* Placeholder for app preview image - you can replace this with actual image */}
          <div className="absolute inset-0 bg-white rounded-lg shadow-2xl flex items-center justify-center">
            <div className="text-center space-y-4 p-12">
              <div className="text-6xl font-bold text-brand-purple mb-4">
                Plinth
              </div>
              <p className="text-gray-600 text-lg">
                Your complete HRIS solution
              </p>
              <div className="grid grid-cols-3 gap-4 mt-8">
                <div className="bg-gray-100 rounded-lg p-4 h-32"></div>
                <div className="bg-gray-100 rounded-lg p-4 h-32"></div>
                <div className="bg-gray-100 rounded-lg p-4 h-32"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
