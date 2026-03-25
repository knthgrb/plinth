"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { AuthSidePanel } from "@/components/auth-side-panel";

const PENDING_SIGNOUT_KEY = "pendingSignOut";
const marketingUrl =
  process.env.NEXT_PUBLIC_MARKETING_APP_URL ?? process.env.NEXT_PUBLIC_MARKETING_URL ?? "/";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Complete sign-out after navigating here (org tree is unmounted, so no Convex auth errors)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(PENDING_SIGNOUT_KEY)) {
      sessionStorage.removeItem(PENDING_SIGNOUT_KEY);
      authClient.signOut();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        toast({
          title: "Sign in failed",
          description: result.error.message || "Invalid email or password",
          variant: "destructive",
        });
      } else {
        // Ensure session is readable, then full navigation so cookies + middleware see auth
        // (client router.push alone can race Convex / role cookie on first load).
        await authClient.getSession();
        const redirectParam = searchParams.get("redirect");
        window.location.assign(redirectParam || "/");
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

  return (
    <div className="flex min-h-screen overflow-hidden bg-white">
      {/* Left Side - Form (white bg, z-10, overflow-hidden to clip snapshot overflow) */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-hidden bg-white px-6 py-12">
        <div className="w-full max-w-md space-y-8">
          <Link
            href={marketingUrl}
            className="inline-block mb-6 text-xl font-semibold text-brand-purple transition-colors hover:text-brand-purple-hover focus:outline-none focus:ring-0"
            title="Go to Plinth"
          >
            Plinth
          </Link>
          <div className="space-y-2">
            <h1 className="text-3xl font-light tracking-tight text-gray-900">
              Welcome back
            </h1>
            <p className="text-sm text-gray-500">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 border-gray-300 bg-white text-base pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-brand-purple hover:text-brand-purple-hover font-medium"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              variant="default"
              className="w-full h-12 text-base font-normal"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="text-center">
            <p className="text-sm text-gray-500">
              Don't have an account?{" "}
              <Link
                href="/signup"
                className="text-brand-purple hover:text-brand-purple-hover font-medium"
              >
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>

      <AuthSidePanel />
    </div>
  );
}
