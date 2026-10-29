import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectDetailScreen } from "@/components/cxo/ProjectDetailScreen";
import { TableSkeleton } from "@/components/cxo/ui";

export const metadata: Metadata = { title: "Project" };

export default function Page() {
  return (
    <Suspense fallback={<TableSkeleton rows={5} />}>
      <ProjectDetailScreen />
    </Suspense>
  );
}
