import { Suspense } from "react";

import RemittancesPageClient from "./remittances-page-client";

export default function GovernmentRemittancesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center p-8 text-gray-500">
          Loading government remittances…
        </div>
      }
    >
      <RemittancesPageClient />
    </Suspense>
  );
}
