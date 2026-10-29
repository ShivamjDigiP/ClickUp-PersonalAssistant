"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Heatmap, Kpi } from "@/components/MeCharts";
import type { PersonWork } from "@/lib/analytics/personWork";
import { api, useApi } from "./api";
import { PersonCode } from "./PersonCode";
import { PersonTasks } from "./PersonTasks";
import { LEVEL_LABEL, ROLE_LABEL, type Level, type Role } from "@/lib/analytics/types";
import { Avatar, Btn, dateText, ErrorBox, PageHeader, Periods, pctText, Section, SplitBar, TableSkeleton, WIDE_PERIODS, Notes, type Note } from "./ui";

type Work = { commits: number; merges: number; prsMerged: number; prsOpen: number };
type Detail = {
  card: {
    person: { id: string; name: string; level: Level; role?: Role; startDate: number };
    usesCode: boolean;
    notes: Note[];
    completedDelta: number;
    profile: { weeksOfHistory: number; samples: number; confidence: string };
    metrics: { current: { completed: number; importedDone: number; assigned: number; openNow: number; overdueOpen: number; onTimeRate: number | null; reworkRate: number | null; cycleDaysMedian: number | null; prCycleHoursMedian: number | null }; previous: { completed: number } };
  };
  range: number;
  forecast: { openTasks: number; forecast: { p50: number; p80: number; confidence: string } | null; capacity: { low: number; likely: number; high: number; confidence: string } } | null;
  breakdown: {
    projects: { projectId: string; name: string; work: Work; tasksDone: number; tasksOpen: number; byLayer: Record<string, Work>; byPart: Record<string, Work> }[];
    layers: Record<string, Work>;
    notInAnyProject: Work;
  };
  activity: { date: string; commits: number; completed: number }[];
  work: PersonWork;
};
type InsightOut = { insight: { headline: string; doingWell: string[]; risks: string[]; actions: string[] }; source: "ai" | "rules"; engine?: string };

// Shown one after another while the summary is being written, so the wait says what is actually happening.
const WORKING_ON_IT = [
  "Fetching GitHub commits and pull requests…",
  "Checking the task tool (ClickUp / Jira) for assigned and finished work…",
  "Counting tasks that were finished on time…",
  "Looking at open work and anything past its due date…",
  "Comparing this period with the one before…",
  "Reading how pull requests moved through review…",
  "Checking which numbers can be trusted and which are missing…",
  "Putting the facts into plain words…",
  "Double-checking every figure against the data…",
];

const rangeLabel = (d: number) => (d === 0 ? "everything on record" : d === 365 ? "last year" : `last ${d} days`);

export function PersonScreen() {
  const { id } = useParams<{ id: string }>();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useApi<Detail>(`/api/cxo/people/${id}?days=${days}`);
  const [now] = useState(() => Date.now()); // read once: render must not depend on the clock
  const [insight, setInsight] = useState<InsightOut | null>(null);
  const [writing, setWriting] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => setStep((n) => Math.min(n + 1, WORKING_ON_IT.length - 1)), 1800);
    return () => clearInterval(t);
  }, [writing]);

  async function writeSummary() {
    setWriting(true);
    setStep(0);
    setInsightError(null);
    try {
      setInsight(await api<InsightOut>(`/api/cxo/people/${id}/insight?days=${days}`, { method: "POST", body: {} }));
    } catch (e) {
      setInsightError((e as Error).message);
    } finally {
      setWriting(false);
    }
  }

  // 12 weeks of days, oldest first, so the heatmap lines up with weekdays
  const heat = useMemo(() => {
    const byDate = new Map((data?.activity ?? []).map((a) => [a.date, a.commits + a.completed]));
    return Array.from({ length: 84 }, (_, i) => {
      const date = new Date(now - (83 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: byDate.get(date) ?? 0 };
    });
  }, [data, now]);

  const header = (
    <PageHeader
      title={data?.card.person.name ?? "Developer"}
      sub={data ? <><Link href="/cxo/people" className="underline underline-offset-2">People</Link> · {data.card.person.role ? ROLE_LABEL[data.card.person.role] : "No role set"} · {LEVEL_LABEL[data.card.person.level]} · first interaction {new Date(data.card.person.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</> : undefined}
      right={<Periods value={days} options={WIDE_PERIODS} onChange={setDays} />}
    />
  );
  if (error && !data) return <>{header}<ErrorBox message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<TableSkeleton rows={6} /></>;

  const { card, forecast, breakdown, work } = data;
  const m = card.metrics.current;
  const layerParts = Object.entries(breakdown.layers).map(([key, w]) => ({ key, value: w.commits }));
  const range = rangeLabel(data.range);

  return (
    <>
      {header}

      <div className="glass mb-5 flex flex-wrap items-center gap-5 p-4 sm:p-5">
        <Avatar name={card.person.name} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--muted)]">
            {card.usesCode ? "Followed through tasks and GitHub work." : "Followed through tasks."} {card.profile.weeksOfHistory} weeks since the first interaction.
          </p>
          {card.notes.length > 0 ? <div className="mt-3"><Notes notes={card.notes} /></div> : <p className="mt-2 text-sm text-[var(--muted)]">Nothing stands out right now.</p>}

        </div>
        <button onClick={writeSummary} disabled={writing} className={`${Btn.primary} self-start`} style={Btn.primaryStyle}>{writing ? "Writing…" : insight ? "Write it again" : "✦ AI summary"}</button>
      </div>

      {(writing || insight || insightError) && (
        <Section title="AI summary" className="mb-5" hint={insight && !writing ? (insight.source === "ai" ? `written by ${insight.engine ?? "AI"}` : "fixed rules") : undefined}>
          {insightError && !writing && <ErrorBox message={insightError} />}
          {writing && (
            <div className="flex items-center gap-3 text-sm text-[var(--muted)]" role="status" aria-live="polite">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full" style={{ background: "var(--violet)" }} aria-hidden />
              <span key={step}>{WORKING_ON_IT[step]}</span>
            </div>
          )}
          {insight && !writing && (
            <div className="space-y-4 text-sm">
              <p className="text-base font-light leading-snug">{insight.insight.headline}</p>
              <div className="grid gap-5 md:grid-cols-3">
                {[["What they did", insight.insight.doingWell, "var(--teal)"], ["Worth a look", insight.insight.risks, "var(--amber)"], ["Questions to ask", insight.insight.actions, "var(--violet)"]].map(([title, items, color]) => (items as string[]).length > 0 && (
                  <div key={title as string}>
                    <p className="mb-1.5 text-[11px] uppercase tracking-widest text-[var(--muted)]">{title as string}</p>
                    <ul className="space-y-1.5">{(items as string[]).map((t, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color as string }} />{t}</li>)}</ul>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--muted)]">{insight.source === "ai" ? "Every number was checked against the data." : "Built from the numbers by fixed rules (the AI was unavailable or gave an unverifiable answer)."}</p>
            </div>
          )}
        </Section>
      )}

      {/* The same totals the task tool shows. Nothing is hidden; the rating notes below say what it uses. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <Kpi label="Tasks assigned" value={work.tasks.total} accent="var(--fg)" sub={`in ${work.tasks.byProject.length} project${work.tasks.byProject.length === 1 ? "" : "s"}${work.tasks.subtasks ? ` · includes ${work.tasks.subtasks} subtasks` : ""} · ${range}`} hint="Every task assigned to this person, finished in the period or still open: the same count as the task tool." />
        <Kpi label="Finished" value={work.tasks.finished} accent="var(--teal)" sub={work.tasks.notCounted ? `${m.completed} used for the rating, ${work.tasks.notCounted} from a bulk import are not` : `${m.completed} used for the rating`} />
        <Kpi label="Open now" value={work.tasks.open} accent={work.tasks.overdue ? "var(--coral)" : "var(--amber)"} sub={`${work.tasks.overdue} overdue`} />
        <Kpi label="Finished on time" value={m.onTimeRate === null ? null : Math.round(m.onTimeRate * 100)} suffix="%" accent="var(--violet)" sub="of tasks that had a due date" />
        <Kpi label="Commits" value={work.code.commits} accent="var(--fg)" sub={work.code.mergeCommits ? `${work.code.mergeCommits} only merge branches` : "on GitHub, merge commits not counted"} />
        <Kpi label="Pull requests merged" value={work.code.prsMerged} accent="var(--fg)" sub={`${work.code.prsOpen} open now`} />
      </div>

      <div className="mt-5"><PersonTasks tasks={work.tasks} rangeText={range} /></div>
      <div className="mt-5"><PersonCode code={work.code} rangeText={range} /></div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Open work and forecast">
          {forecast && forecast.openTasks > 0 ? (
            <div className="space-y-3 text-sm">
              <p>{forecast.openTasks} tasks open.{forecast.forecast ? <> At their usual pace they are most likely done by <b>{dateText(forecast.forecast.p50)}</b>, and almost certainly by <b>{dateText(forecast.forecast.p80)}</b>.</> : null}</p>
              <p className="text-[var(--muted)]">Next two weeks they can take on about <b className="text-[var(--fg)]">{Math.round(forecast.capacity.low)}–{Math.round(forecast.capacity.high)}</b> more tasks (most likely {Math.round(forecast.capacity.likely)}).</p>
              {(forecast.capacity.confidence === "none" || forecast.capacity.confidence === "low") && <p className="rounded-xl bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] px-3 py-2 text-xs">Little history: these dates lean on the typical pace for their level and will sharpen over time.</p>}
            </div>
          ) : <p className="text-sm text-[var(--muted)]">Nothing open right now{forecast ? `. Capacity for the next two weeks: about ${Math.round(forecast.capacity.low)}–${Math.round(forecast.capacity.high)} tasks.` : "."}</p>}
          <p className="mt-3 text-xs text-[var(--muted)]">The open tasks are listed in the Tasks section above.{m.reworkRate === null ? " Reopen counts are not available from ClickUp." : ` ${pctText(m.reworkRate)} of finished tasks were reopened.`}</p>
        </Section>

        <Section title="Activity" hint="commits + tasks finished, last 12 weeks">
          <Heatmap days={heat} />
        </Section>
      </div>

      {(layerParts.length > 0 || breakdown.projects.length > 0) && (
        <Section title="Frontend, backend and projects" className="mt-5" hint={range}>
          <div className="space-y-6">
            {layerParts.length > 0 && <div><p className="mb-2 text-xs text-[var(--muted)]">Commits by layer, across all projects</p><SplitBar parts={layerParts} /></div>}
            {breakdown.projects.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]"><tr><th className="pb-2 font-normal">Project</th><th className="pb-2 font-normal">Split</th><th className="pb-2 text-right font-normal">Commits</th><th className="pb-2 text-right font-normal">PRs merged</th><th className="pb-2 text-right font-normal">PRs open</th><th className="pb-2 text-right font-normal">Tasks</th></tr></thead>
                  <tbody>
                    {breakdown.projects.map((p) => (
                      <tr key={p.projectId} className="border-t border-[var(--glass-border)] align-middle">
                        <td className="py-2.5 pr-3"><Link href={`/cxo/projects/${p.projectId}`} className="hover:underline">{p.name}</Link></td>
                        <td className="w-1/3 py-2.5 pr-4"><SplitBar parts={Object.entries(p.byLayer).map(([key, w]) => ({ key, value: w.commits }))} legend={false} height={8} />
                          <p className="mt-1 text-[10px] text-[var(--muted)]">{Object.entries(p.byLayer).map(([k, w]) => `${k} ${w.commits}`).join(" · ")}{Object.keys(p.byPart).filter((k) => k !== "(no part)").length ? ` | ${Object.entries(p.byPart).filter(([k]) => k !== "(no part)").map(([k, w]) => `${k} ${w.commits}`).join(" · ")}` : ""}</p></td>
                        <td className="py-2.5 text-right tabular-nums">{p.work.commits}</td>
                        <td className="py-2.5 text-right tabular-nums">{p.work.prsMerged}</td>
                        <td className="py-2.5 text-right tabular-nums">{p.work.prsOpen}</td>
                        <td className="py-2.5 text-right tabular-nums">{p.tasksDone + p.tasksOpen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {breakdown.notInAnyProject.commits > 0 && <p className="text-xs text-[var(--muted)]">{breakdown.notInAnyProject.commits} commits are in repositories that are not part of any project. <Link href="/cxo/projects" className="underline underline-offset-2">Group them</Link></p>}
          </div>
        </Section>
      )}
      {loading && <p className="mt-4 text-xs text-[var(--muted)]">Refreshing…</p>}
    </>
  );
}
