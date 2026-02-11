"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { MessageCircle } from "lucide-react";

export default function ChatPage() {
  return (
    <MainLayout>
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <MessageCircle className="h-16 w-16 text-gray-400" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Coming Soon
          </h1>
          <p className="text-gray-500 text-lg">
            Chat feature is under development
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
