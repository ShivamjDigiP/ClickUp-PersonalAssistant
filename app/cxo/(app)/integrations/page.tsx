import type { Metadata } from "next";
import { IntegrationsScreen } from "@/components/cxo/IntegrationsScreen";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <IntegrationsScreen />;
}
