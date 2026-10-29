import type { Metadata } from "next";
import { ProjectsScreen } from "@/components/cxo/ProjectsScreen";

export const metadata: Metadata = { title: "Projects" };

export default function Page() {
  return <ProjectsScreen />;
}
