"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const createOrganization = useMutation(
    (api as any).organizations.createOrganization
  );
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    organizationName: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Create user account with Better Auth
      const signUpResult = await authClient.signUp.email({
        email: formData.email,
        password: formData.password,
        name: formData.email.split("@")[0], // Use email prefix as temporary name
      });

      if (signUpResult.error) {
        setError(signUpResult.error.message || "Signup failed");
        setLoading(false);
        return;
      }

      // Wait a bit for Better Auth to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create organization (this will also create/update the user record)
      await createOrganization({
        name: formData.organizationName,
        email: formData.email,
      });

      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm space-y-12">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-light tracking-tight text-gray-900">
            Get started
          </h1>
          <p className="text-sm text-gray-500">
            Create your account to get started
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <Input
                id="organizationName"
                type="text"
                placeholder="Organization name"
                value={formData.organizationName}
                onChange={(e) =>
                  setFormData({ ...formData, organizationName: e.target.value })
                }
                required
                className="h-12 border-gray-300 bg-white text-base"
              />
            </div>
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
            <div>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                required
                minLength={8}
                className="h-12 border-gray-300 bg-white text-base"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full cursor-pointer h-12 bg-purple-700 text-white hover:bg-purple-600 text-base font-normal"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Sign Up"}
          </Button>
        </form>

        <div className="text-center">
          <p className="text-sm text-gray-500">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-purple-700 hover:text-purple-600 font-medium"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
