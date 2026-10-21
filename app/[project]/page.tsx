import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProjectScreen } from "@/components/project/ProjectScreen";
import { findProjectBySlug } from "@/lib/clickup/projects";
import { fromParams } from "@/lib/projectFilters";

type Props = {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const { project } = await params;
  const p = await findProjectBySlug(decodeURIComponent(project)).catch(() => null);
  return { title: p ? `${p.name} · ClickUp Assistant` : "ClickUp Assistant" };
}

async function ProjectContent({ params, searchParams }: Props) {
  await connection();
  const { project } = await params;
  const p = await findProjectBySlug(decodeURIComponent(project));
  if (!p) notFound();

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, x);

  return <ProjectScreen id={p.id} name={p.name} filters={fromParams(sp)} />;
}

// /imported-from-jira  ->  that project's page. Filters can ride along: /imported-from-jira?status=backlog&person=123
// The request-specific work lives inside <Suspense> so the shell can be prerendered and the project streams in.
export default function ProjectRoute(props: Props) {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">Loading project…</div>}>
      <ProjectContent {...props} />
    </Suspense>
  );
}
