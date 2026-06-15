import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { OrganizationProvider } from "@/hooks/organization-context";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Plinth",
  description: "Plinth is an HRIS system for businesses in the Philippines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="font-sans" suppressHydrationWarning>
      <body className="antialiased font-sans" suppressHydrationWarning>
        <ConvexClientProvider>
          <OrganizationProvider>
            {children}
            <Toaster />
          </OrganizationProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
