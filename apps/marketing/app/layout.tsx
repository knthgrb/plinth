import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import "./globals.css";
import { MarketingHeader } from "./_components/marketing-header";

const openSans = Open_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-open-sans",
  display: "swap",
});

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
      <body className="antialiased font-sans bg-white text-gray-900 overflow-x-hidden" suppressHydrationWarning>
        <div className="min-h-screen flex flex-col bg-white overflow-x-hidden">
          <MarketingHeader />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
