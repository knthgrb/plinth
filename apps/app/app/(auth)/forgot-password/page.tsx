"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (result.error) {
        toast({
          title: "Error",
          description: result.error.message || "Failed to send reset email",
          variant: "destructive",
        });
      } else {
        setEmailSent(true);
        toast({
          title: "Email sent",
          description: "Check your email for password reset instructions",
        });
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-light tracking-tight text-gray-900">
              Check your email
            </h1>
            <p className="text-sm text-gray-500">
              We've sent password reset instructions to {email}
            </p>
          </div>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Click the link in the email to reset your password. The link will
              expire in 1 hour.
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                Back to Sign In
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm space-y-12">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-light tracking-tight text-gray-900">
            Forgot password?
          </h1>
          <p className="text-sm text-gray-500">
            Enter your email address and we'll send you a link to reset your
            password
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Input
              id="email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 border-gray-300 bg-white text-base"
            />
          </div>

          <Button
            type="submit"
            variant="default"
            className="w-full h-12 text-base font-normal"
            disabled={loading}
          >
            {loading ? "Sending..." : "Send reset link"}
          </Button>
        </form>

        <div className="text-center">
          <Link
            href="/login"
            className="text-sm text-brand-purple hover:text-brand-purple-hover font-medium"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
