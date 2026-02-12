import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { OrganizationProvider } from "@/hooks/organization-context";
import { LoaderOverlayProvider } from "@/hooks/loader-overlay-context";
import { Toaster } from "@/components/ui/toaster";

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-open-sans",
  display: "swap",
});

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
    <html
      lang="en"
      className={`${openSans.variable} font-sans`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased font-sans" suppressHydrationWarning>
        <ConvexClientProvider>
          <OrganizationProvider>
            <LoaderOverlayProvider>
              {children}
              <Toaster />
            </LoaderOverlayProvider>
          </OrganizationProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
