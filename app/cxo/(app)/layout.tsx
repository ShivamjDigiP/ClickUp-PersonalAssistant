import type { Metadata } from "next";
import { CxoShell } from "@/components/cxo/CxoShell";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: { default: BRAND.name, template: `%s · ${BRAND.name}` }, robots: { index: false, follow: false } };

export default function CxoLayout({ children }: { children: React.ReactNode }) {
  return <CxoShell>{children}</CxoShell>;
}
