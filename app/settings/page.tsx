"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to account settings by default
    router.replace("/settings/account");
  }, [router]);

  return null;
}
