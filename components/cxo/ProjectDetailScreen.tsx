"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ColumnChart, Kpi } from "@/components/MeCharts";
import { useApi } from "./api";
import { ProjectEditor, type EditorValue, type KnownList, type KnownRepo } from "./ProjectEditor";
import { Avatar, Btn, colorForKey, dateText, ErrorBox, inputCls, PageHeader, Periods, Section, SplitBar, TableSkeleton, WIDE_PERIODS } from "./ui";

type Work = { commits: number; merges: number; prsMerged: number; prsOpen: number };
type Breakdown = { key: string; repos: string[]; work: Work; contributors: number };
type ListWork = { source: string; name: string; done: number; open: number };
type Person = {
  personId: string; name: string; work: Work; kinds: Record<string, number>; shareOfCommits: number; tasksDone: number; tasksOpen: number;
  byList: Record<string, ListWork>; byLayer: Record<string, Work>; byPart: Record<string, Work>;
  byRepo: { repo: string; layer: string; part: string | null; work: Work }[];
  prQuality: { reviewed: number; firstPass: number; medianHoursToMerge: number | null };
};
type Report = {
  project: { id: string; name: string; description: string | null; repos: { repo: string; layer: string; part: string | null }[]; taskLists: string[] };
  days: number;
  totals: Work & { contributors: number; tasksDone: number; tasksOpen: number; tasksAssigned: number; reviewed: number; firstPass: number };
  layers: Breakdown[];
  parts: Breakdown[];
  repos: { repo: string; layer: string; part: string | null; work: Work; contributors: number }[];
  lists: (ListWork & { people: number })[];
  statuses: { status: string; stage: string; count: number }[];
  sources: string[];
  people: Person[];
  weekly: { weekStart: number; commits: number; tasksDone: number }[];
};
type Lists = { repos: KnownRepo[]; taskLists: KnownList[] };

type View = "layer" | "part" | "repo" | "list";
const VIEW_LABEL: Record<View, string> = { layer: "By layer", part: "By part", repo: "By repository", list: "By task list" };
const SOURCE_LABEL: Record<string, string> = { clickup: "ClickUp", jira: "Jira", tasks: "Tasks" };
const zero = (): Work => ({ commits: 0, merges: 0, prsMerged: 0, prsOpen: 0 });
const sum = (rows: Work[]) => rows.reduce((t, w) => { for (const k of Object.keys(t) as (keyof Work)[]) t[k] += w[k]; return t; }, zero());

export function ProjectDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const [days, setDays] = useState(30);
  const [view, setView] = useState<View>("layer");
  const [repoFilter, setRepoFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [editing, setEditing] = useState<EditorValue | null>(null);
  const { data, error, loading, reload } = useApi<Report>(`/api/cxo/projects/${id}?days=${days}`);
  const lists = useApi<Lists>(editing ? "/api/cxo/projects" : null);

  const header = (
    <PageHeader
      title={data?.project.name ?? "Project"}
      sub={data ? <><Link href="/cxo/projects" className="underline underline-offset-2">Projects</Link> · {data.project.repos.length} repositories · {data.project.taskLists.length} task lists{data.project.description ? ` · ${data.project.description}` : ""}</> : undefined}
      right={
        <>
          <Periods value={days} options={WIDE_PERIODS} onChange={setDays} />
          {data && <button onClick={() => setEditing({ id: data.project.id, name: data.project.name, description: data.project.description, repos: data.project.repos, taskLists: data.project.taskLists })} className={Btn.ghost}>Edit</button>}
        </>
      }
    />
  );

  // Everything in the "who did what" table is computed from the one report, so filters are instant and always agree with the totals above.
  const grid = useMemo(() => {
    if (!data) return null;
    const keepList = (l: ListWork) => !sourceFilter || l.source === sourceFilter;
    const repoRows = (p: Person) => p.byRepo.filter((r) => !repoFilter || r.repo === repoFilter);
    const columns: { key: string; label: string; badge?: string }[] =
      view === "layer" ? [...new Set(data.repos.filter((r) => !repoFilter || r.repo === repoFilter).map((r) => r.layer))].map((k) => ({ key: k, label: k }))
      : view === "part" ? [...new Set(data.repos.filter((r) => !repoFilter || r.repo === repoFilter).map((r) => r.part ?? "(no part)"))].map((k) => ({ key: k, label: k }))
      : view === "repo" ? data.repos.filter((r) => (!repoFilter || r.repo === repoFilter) && (r.work.commits || r.work.prsMerged)).map((r) => ({ key: r.repo, label: r.repo.split("/").pop() ?? r.repo }))
      : data.lists.filter(keepList).map((l) => ({ key: `${l.source}::${l.name}`, label: l.name, badge: SOURCE_LABEL[l.source] ?? l.source }));
    const cell = (p: Person, key: string): Work | ListWork | undefined => {
      if (view === "list") return p.byList[key];
      const rows = repoRows(p).filter((r) => (view === "layer" ? r.layer === key : view === "part" ? (r.part ?? "(no part)") === key : r.repo === key));
      return rows.length ? sum(rows.map((r) => r.work)) : undefined;
    };
    const rows = data.people
      .map((p) => {
        const code = sum(repoRows(p).map((r) => r.work));
        const mine = Object.values(p.byList).filter(keepList);
        const tasksDone = mine.reduce((n, l) => n + l.done, 0);
        const tasksOpen = mine.reduce((n, l) => n + l.open, 0);
        return { p, code, tasksDone, tasksOpen };
      })
      .filter((r) => (view === "list" ? r.tasksDone + r.tasksOpen > 0 : r.code.commits + r.code.prsMerged > 0 || (!repoFilter && r.tasksDone + r.tasksOpen > 0)));
    const totalCommits = rows.reduce((n, r) => n + r.code.commits, 0) || 1;
    return { columns, cell, rows, totalCommits };
  }, [data, view, repoFilter, sourceFilter]);

  if (error && !data) return <>{header}<ErrorBox message={error} onRetry={reload} /></>;
  if (!data || !grid) return <>{header}<TableSkeleton rows={5} /></>;

  const t = data.totals;
  const hasParts = data.parts.some((p) => p.key !== "(no part)");
  const colMax = (key: string) => Math.max(1, ...grid.rows.map((r) => { const c = grid.cell(r.p, key); return c ? ("commits" in c ? c.commits : c.done + c.open) : 0; }));

  return (
    <>
      {header}
      {editing && lists.data && (
        <ProjectEditor key={editing.id} initial={editing} repos={lists.data.repos} lists={lists.data.taskLists} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Kpi label="Commits" value={t.commits} accent="var(--violet)" sub={t.merges ? `${t.merges} only merge branches` : undefined} />
        <Kpi label="PRs merged" value={t.prsMerged} accent="var(--teal)" sub={`${t.prsOpen} open now`} />
        <Kpi label="PRs open now" value={t.prsOpen} accent="var(--amber)" sub="waiting to be merged" />
        <Kpi label="Tasks completed" value={t.tasksDone} accent="var(--teal)" sub={`${t.tasksOpen} still open${data.sources.length ? ` · ${data.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" + ")}` : ""}`} />
        <Kpi label="Contributors" value={t.contributors} accent="var(--fg)" sub={`${data.repos.filter((r) => r.work.commits).length} of ${data.project.repos.length} repositories active`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Where the work went">
          <div className="space-y-5">
            <div><p className="mb-2 text-xs text-[var(--muted)]">Commits by layer</p><SplitBar parts={data.layers.map((l) => ({ key: l.key, value: l.work.commits }))} /></div>
            <div><p className="mb-2 text-xs text-[var(--muted)]">Pull requests merged by layer</p><SplitBar parts={data.layers.map((l) => ({ key: l.key, value: l.work.prsMerged }))} /></div>
            {hasParts && <div><p className="mb-2 text-xs text-[var(--muted)]">Commits by part (admin, user, …)</p><SplitBar parts={data.parts.map((p) => ({ key: p.key, value: p.work.commits }))} /></div>}
          </div>
        </Section>
        <Section title="Tasks by status" hint={`${data.statuses.reduce((n, s) => n + s.count, 0)} tasks`}>
          {data.statuses.length ? <SplitBar parts={data.statuses.map((s) => ({ key: s.status, value: s.count }))} /> : <p className="text-sm text-[var(--muted)]">This project has no task lists yet: edit it to add the ClickUp lists or Jira projects it uses.</p>}
          <p className="mt-3 text-[11px] text-[var(--muted)]">Statuses are the words your team uses in ClickUp or Jira. Open a developer&apos;s page to see their individual tasks.</p>
        </Section>
        <Section title="Activity by week" hint="commits and tasks completed">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColumnChart data={data.weekly.slice(-12).map((w) => ({ label: dateText(w.weekStart), value: w.commits }))} color="var(--violet)" height={110} />
            <ColumnChart data={data.weekly.slice(-12).map((w) => ({ label: dateText(w.weekStart), value: w.tasksDone }))} color="var(--teal)" height={110} />
          </div>
        </Section>
      </div>

      <Section title="Who did what" className="mt-5" hint={`${grid.rows.length} people`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Group by">
            {(Object.keys(VIEW_LABEL) as View[]).map((v) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className="chip">{VIEW_LABEL[v]}</button>)}
          </div>
          <span className="mx-1 hidden h-5 w-px bg-[var(--glass-border)] sm:block" aria-hidden />
          <select aria-label="Filter by repository" value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} className={`${inputCls} !w-auto max-w-[16rem]`}>
            <option value="" className="bg-slate-900">All repositories</option>
            {data.project.repos.map((r) => <option key={r.repo} value={r.repo} className="bg-slate-900">{r.repo.split("/").pop()} ({r.layer}{r.part ? ` / ${r.part}` : ""})</option>)}
          </select>
          {data.sources.length > 0 && (
            <select aria-label="Filter by task tool" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={`${inputCls} !w-auto`}>
              <option value="" className="bg-slate-900">All task tools</option>
              {data.sources.map((s) => <option key={s} value={s} className="bg-slate-900">{SOURCE_LABEL[s] ?? s} tasks only</option>)}
            </select>
          )}
          {(repoFilter || sourceFilter) && <button onClick={() => { setRepoFilter(""); setSourceFilter(""); }} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]">Clear filters</button>}
        </div>

        {grid.rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing matches these filters in this period.{data.project.repos.length === 0 ? " This project has no repositories yet: edit it to add some." : ""}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 520 + grid.columns.length * 140 }}>
              <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
                <tr>
                  <th className="pb-2 font-normal">Developer</th>
                  {grid.columns.map((c, i) => (
                    <th key={c.key} className="pb-2 pr-4 font-normal">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colorForKey(c.key, i) }} />{c.label}
                      {c.badge && <span className="ml-1.5 rounded-full bg-[rgb(var(--tint)/0.1)] px-1.5 py-0.5 text-[9px] normal-case tracking-normal">{c.badge}</span>}
                    </th>
                  ))}
                  <th className="pb-2 text-right font-normal">Commits</th>
                  <th className="pb-2 text-right font-normal">PRs merged</th>
                  <th className="pb-2 text-right font-normal">PRs open</th>
                  <th className="pb-2 text-right font-normal">Tasks done</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map(({ p, code, tasksDone, tasksOpen }) => (
                  <tr key={p.personId} className="border-t border-[var(--glass-border)] align-middle">
                    <td className="py-2.5 pr-3">
                      <Link href={`/cxo/people/${p.personId}`} className="flex items-center gap-2.5 hover:underline"><Avatar name={p.name} size={28} /><span className="min-w-0"><span className="block truncate">{p.name}</span><span className="block text-[10px] text-[var(--muted)]">{Math.round((code.commits / grid.totalCommits) * 100)}% of commits</span></span></Link>
                    </td>
                    {grid.columns.map((c, i) => {
                      const v = grid.cell(p, c.key);
                      const isList = v && "done" in v;
                      const n = v ? (isList ? v.done + v.open : (v as Work).commits) : 0;
                      return (
                        <td key={c.key} className="py-2.5 pr-4">
                          {v && (isList ? n > 0 : (v as Work).commits || (v as Work).prsMerged) ? (
                            <div>
                              <div className="text-xs tabular-nums">
                                {isList ? <>{(v as ListWork).done} done{(v as ListWork).open ? <span className="text-[var(--muted)]"> · {(v as ListWork).open} open</span> : null}</>
                                  : <>{(v as Work).commits} commits{(v as Work).prsMerged || (v as Work).prsOpen ? <span className="text-[var(--muted)]"> · {(v as Work).prsMerged} merged{(v as Work).prsOpen ? ` · ${(v as Work).prsOpen} open` : ""} PRs</span> : null}</>}
                              </div>
                              <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]"><div className="h-full rounded-full" style={{ width: `${(n / colMax(c.key)) * 100}%`, background: colorForKey(c.key, i) }} /></div>
                            </div>
                          ) : <span className="text-xs text-[var(--muted)]">–</span>}
                        </td>
                      );
                    })}
                    <td className="py-2.5 text-right tabular-nums">{code.commits}</td>
                    <td className="py-2.5 text-right tabular-nums">{code.prsMerged}</td>
                    <td className="py-2.5 text-right tabular-nums">{code.prsOpen}</td>
                    <td className="py-2.5 text-right tabular-nums">{tasksDone}{tasksOpen ? <span className="text-[var(--muted)]"> (+{tasksOpen} open)</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
          Counts show activity, not value. Release merges between long-lived branches (develop to main) are not counted as anyone&apos;s pull requests. Bars are relative to the busiest person in that column. Open a developer&apos;s page to see every commit and pull request with its GitHub link.
        </p>
      </Section>

      <Section title="Repositories" className="mt-5" hint={`${data.repos.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
              <tr><th className="pb-2 font-normal">Repository</th><th className="pb-2 font-normal">Layer</th><th className="pb-2 font-normal">Part</th><th className="pb-2 text-right font-normal">Commits</th><th className="pb-2 text-right font-normal">PRs merged</th><th className="pb-2 text-right font-normal">PRs open</th><th className="pb-2 text-right font-normal">People</th></tr>
            </thead>
            <tbody>
              {data.repos.map((r) => (
                <tr key={r.repo} className="border-t border-[var(--glass-border)]">
                  <td className="py-2.5 pr-3"><button onClick={() => setRepoFilter(r.repo)} className="text-left underline-offset-2 hover:underline" title="Filter “Who did what” to this repository">{r.repo}</button></td>
                  <td className="py-2.5 pr-3"><span className="rounded-full px-2 py-0.5 text-[11px] capitalize" style={{ color: colorForKey(r.layer), background: `color-mix(in srgb, ${colorForKey(r.layer)} 14%, transparent)` }}>{r.layer}</span></td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">{r.part ?? "–"}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.work.commits}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.work.prsMerged}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.work.prsOpen}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.contributors}</td>
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
