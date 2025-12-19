"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Receipt,
  Calendar,
  FileText,
  MessageCircle,
  Bell,
  LogOut,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { authClient } from "@/lib/auth-client";

const navigation = [
  { name: "Announcements", href: "/announcements", icon: Bell },
  { name: "Payslips", href: "/payslips", icon: Receipt },
  { name: "Leave", href: "/leave", icon: Calendar },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Chat", href: "/chat", icon: MessageCircle },
];

export function EmployeeSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <h1 className="text-xl font-bold text-purple-600">Purple Pay</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-purple-50 text-purple-600"
                  : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-200 p-3">
        <button
          onClick={handleLogout}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
          )}
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
