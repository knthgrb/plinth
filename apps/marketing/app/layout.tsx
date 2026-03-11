import type { Metadata } from "next";
import Link from "next/link";
import { Open_Sans } from "next/font/google";
import "./globals.css";
import { MarketingNav } from "./_components/marketing-nav";

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-open-sans",
  display: "swap",
});

const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";

export const metadata: Metadata = {
  title: "Plinth – One place for your company",
  description:
    "The foundation for companies in the Philippines. People, payroll, compliance, and communication — all in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={openSans.variable} suppressHydrationWarning>
      <body className="antialiased font-sans bg-white text-gray-900" suppressHydrationWarning>
        <div className="min-h-screen flex flex-col bg-white">
          <header className="sticky top-0 z-50 w-full border-b border-gray-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              <Link
                href="/"
                className="flex items-center gap-2 font-semibold text-gray-900"
              >
                <span className="text-xl">Plinth</span>
              </Link>
              <MarketingNav />
              <div className="flex items-center gap-3">
                <Link
                  href="/request-demo"
                  className="text-sm font-medium text-gray-600 hover:text-gray-900"
                >
                  Request demo
                </Link>
                <Link
                  href={mainAppUrl ? `${mainAppUrl}/login` : "/login"}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900"
                >
                  Log in
                </Link>
                <Link
                  href={mainAppUrl ? `${mainAppUrl}/signup` : "/signup"}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-purple px-4 py-2 text-sm font-medium text-white hover:bg-brand-purple-hover transition-colors"
                >
                  Get Started
                </Link>
              </div>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
