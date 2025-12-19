import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { OrganizationProvider } from "@/hooks/organization-context";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Purple Pay",
  description:
    "Purple Pay is an HRIS system for businesses in the Philippines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ConvexClientProvider>
          <OrganizationProvider>{children}</OrganizationProvider>
          <Toaster />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
