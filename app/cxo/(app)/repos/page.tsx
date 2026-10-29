import type { Metadata } from "next";
import { ReposScreen } from "@/components/cxo/ReposScreen";

export const metadata: Metadata = { title: "Repositories" };

export default function Page() {
  return <ReposScreen />;
}
