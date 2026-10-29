import type { Metadata } from "next";
import { OverviewScreen } from "@/components/cxo/OverviewScreen";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <OverviewScreen />;
}
