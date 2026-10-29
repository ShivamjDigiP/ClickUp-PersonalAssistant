"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "./api";
import { ProjectEditor, type EditorValue, type KnownList, type KnownRepo } from "./ProjectEditor";
import { Btn, Empty, ErrorBox, fmt, PageHeader, Periods, Section, SplitBar, TableSkeleton, WIDE_PERIODS } from "./ui";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  repos: { repo: string; layer: string; part: string | null }[];
  taskLists: string[];
  totals: { commits: number; merges: number; prsMerged: number; prsOpen: number; contributors: number; tasksDone: number; tasksOpen: number };
  layers: { key: string; commits: number }[];
};
type Data = { days: number; projects: ProjectRow[]; repos: KnownRepo[]; taskLists: KnownList[]; suggestions: { name: string; repos: { repo: string; layer: string; part: string | null }[] }[] };

export function ProjectsScreen() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useApi<Data>(`/api/cxo/projects?days=${days}`);
  const [editing, setEditing] = useState<EditorValue | null>(null);

  const header = (
    <PageHeader
      title="Projects"
      sub="Group repositories and task lists into projects, so you can see the whole picture: frontend, backend, admin, user."
      right={
        <>
          <Periods value={days} options={WIDE_PERIODS} onChange={setDays} />
          <button onClick={() => setEditing({ name: "", repos: [], taskLists: [] })} className={Btn.primary} style={Btn.primaryStyle}>New project</button>
        </>
      }
    />
  );

  if (error && !data) return <>{header}<ErrorBox message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<TableSkeleton rows={4} /></>;

  const unassigned = data.repos.filter((r) => r.projects.length === 0);
  const done = () => {
    setEditing(null);
    void reload();
  };

  return (
    <>
      {header}
      {editing && <ProjectEditor key={editing.id ?? editing.name} initial={editing} repos={data.repos} lists={data.taskLists} onSaved={done} onCancel={() => setEditing(null)} />}

      {data.projects.length === 0 && !editing && (
        <Empty title="No projects yet">
          {data.repos.length
            ? "Group your repositories into projects (for example the web, API and admin repos of one product) to see how much each person did on each part."
            : "Connect GitHub under Integrations first, then group the repositories it finds into projects."}
        </Empty>
      )}

      {data.suggestions.length > 0 && !editing && (
        <Section title="Suggested projects" hint="repositories that look related" className="mb-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.suggestions.map((s) => (
              <div key={s.name} className="rounded-2xl bg-[rgb(var(--tint)/0.05)] p-4">
                <p className="text-sm font-medium">{s.name}</p>
                <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
                  {s.repos.map((r) => (
                    <li key={r.repo} className="truncate">{r.repo.split("/").pop()} · {r.layer}{r.part ? ` / ${r.part}` : ""}</li>
                  ))}
                </ul>
                <button onClick={() => setEditing({ name: s.name, repos: s.repos, taskLists: [] })} className={`${Btn.ghost} mt-3`}>Review and create</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.projects.map((p) => (
          <article key={p.id} className="glass flex flex-col p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/cxo/projects/${p.id}`} className="min-w-0 text-lg font-light hover:underline">{p.name}</Link>
              <button onClick={() => setEditing({ id: p.id, name: p.name, description: p.description, repos: p.repos, taskLists: p.taskLists })} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]">Edit</button>
            </div>
            {p.description && <p className="mt-1 text-xs text-[var(--muted)]">{p.description}</p>}
            <p className="mt-1 text-[11px] text-[var(--muted)]">{p.repos.length} repositories · {p.taskLists.length} task lists</p>

            <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
              {[["Commits", p.totals.commits], ["PRs merged", p.totals.prsMerged], ["PRs open", p.totals.prsOpen], ["Tasks done", p.totals.tasksDone]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-[rgb(var(--tint)/0.05)] px-1 py-2">
                  <dd className="text-lg font-light tabular-nums">{fmt(v as number)}</dd>
                  <dt className="text-[10px] text-[var(--muted)]">{k}</dt>
                </div>
              ))}
            </dl>
            <div className="mt-4"><SplitBar parts={p.layers.map((l) => ({ key: l.key, value: l.commits }))} /></div>
            <Link href={`/cxo/projects/${p.id}`} className="mt-4 text-xs text-[var(--violet)] underline underline-offset-2">Open project · {p.totals.contributors} contributors</Link>
          </article>
        ))}
      </div>

      {unassigned.length > 0 && (
        <Section title="Repositories in no project" hint={`${unassigned.length}`} className="mt-5">
          <ul className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {unassigned.slice(0, 40).map((r) => (
              <li key={r.repo} className="flex justify-between gap-3 border-b border-[var(--glass-border)] py-1.5">
                <span className="truncate">{r.repo}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{r.commits} commits{r.suggestedLayer ? ` · looks like ${r.suggestedLayer}` : ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {loading && <p className="mt-4 text-xs text-[var(--muted)]">Refreshing…</p>}
    </>
  );
}
