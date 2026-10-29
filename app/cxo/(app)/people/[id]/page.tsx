import type { Metadata } from "next";
import { Suspense } from "react";
import { PersonScreen } from "@/components/cxo/PersonScreen";
import { TableSkeleton } from "@/components/cxo/ui";

export const metadata: Metadata = { title: "Developer" };

export default function Page() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <PersonScreen />
    </Suspense>
  );
}
