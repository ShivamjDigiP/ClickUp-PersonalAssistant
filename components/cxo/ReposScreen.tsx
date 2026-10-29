"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "./api";
import { Avatar, colorForKey, Empty, ErrorBox, inputCls, PageHeader, Periods, Section, TableSkeleton, WIDE_PERIODS } from "./ui";

type Work = { commits: number; merges: number; prsMerged: number; prsOpen: number };
type Repo = Work & { repo: string; contributors: { personId: string; name: string; work: Work }[]; projects: { project: string; layer: string; part: string | null }[] };

export function ReposScreen() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState("");
  const { data, error, loading, reload } = useApi<{ repos: Repo[] }>(`/api/cxo/repos?days=${days}`);

  const header = <PageHeader title="Repositories" sub="Commits and pull requests per repository, and who contributed." right={<Periods value={days} options={WIDE_PERIODS} onChange={setDays} />} />;
  if (error && !data) return <>{header}<ErrorBox message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<TableSkeleton rows={6} /></>;
  if (!data.repos.length) return <>{header}<Empty title="No repository activity in this period" action={{ href: "/cxo/integrations", label: "Check integrations" }}>Connect GitHub and run a sync, or try a longer period. Only commits from people matched on the People screen are counted.</Empty></>;

  const rows = data.repos.filter((r) => r.repo.toLowerCase().includes(filter.toLowerCase()));
  const max = Math.max(...data.repos.map((r) => r.commits), 1);

  return (
    <>
      {header}
      <Section title="By repository" hint={`${rows.length} of ${data.repos.length}`} right={<input className={`${inputCls} !w-48`} placeholder="Filter repositories…" aria-label="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
              <tr><th className="pb-2 font-normal">Repository</th><th className="pb-2 font-normal">Project</th><th className="pb-2 font-normal">Commits</th><th className="pb-2 text-right font-normal">PRs open</th><th className="pb-2 text-right font-normal">PRs</th><th className="pb-2 pl-4 font-normal">Top contributors</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.repo} className="border-t border-[var(--glass-border)] align-middle">
                  <td className="py-2.5 pr-3">{r.repo}</td>
                  <td className="py-2.5 pr-3">
                    {r.projects.length ? r.projects.map((p) => <span key={p.project} className="mr-1 inline-block rounded-full px-2 py-0.5 text-[11px]" style={{ color: colorForKey(p.layer), background: `color-mix(in srgb, ${colorForKey(p.layer)} 14%, transparent)` }}>{p.project} · {p.layer}{p.part ? `/${p.part}` : ""}</span>) : <Link href="/cxo/projects" className="text-[11px] text-[var(--amber)] underline underline-offset-2">not in a project</Link>}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2"><span className="w-9 text-right tabular-nums">{r.commits}</span><span className="h-1.5 w-24 overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]"><span className="block h-full rounded-full" style={{ width: `${(r.commits / max) * 100}%`, background: "var(--violet)" }} /></span></div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{r.prsOpen}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.prsMerged}</td>
                  <td className="py-2.5 pl-4">
                    <div className="flex -space-x-1.5">
                      {r.contributors.slice(0, 5).map((c) => (
                        <Link key={c.personId} href={`/cxo/people/${c.personId}`} title={`${c.name}: ${c.work.commits} commits, ${c.work.prsMerged} PRs`} className="rounded-full ring-2 ring-[var(--bg)]"><Avatar name={c.name} size={26} /></Link>
                      ))}
                      {r.contributors.length > 5 && <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[rgb(var(--tint)/0.12)] text-[10px] ring-2 ring-[var(--bg)]">+{r.contributors.length - 5}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {loading && <p className="mt-4 text-xs text-[var(--muted)]">Refreshing…</p>}
    </>
  );
}
