"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountFooter } from "./AccountFooter";
import { NotificationSettings } from "./NotificationSettings";
import { motion } from "motion/react";
import { Bars, Donut } from "./Charts";
import { ColumnChart, Heatmap, Kpi, Skeleton, StageBar } from "./MeCharts";
import type { MeStats } from "@/lib/clickup/me";
import type { Project } from "@/app/api/pulse/route";

const PERIODS = [7, 30, 90] as const;
const PRIORITY_COLOR: Record<string, string> = { urgent: "var(--coral)", high: "var(--coral)", normal: "var(--amber)", low: "var(--teal)" };

function Section({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <motion.section className={`glass p-4 sm:p-5 ${className}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-widest text-[var(--muted)]">{title}</h3>
        {hint && <span className="text-[11px] text-[var(--muted)]">{hint}</span>}
      </div>
      {children}
    </motion.section>
  );
}

const weekLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function MeView({
  projects,
  onAsk,
  onSelect,
}: {
  projects: Project[] | null;
  onAsk: (q: string) => void;
  onSelect: (p: Project, x: number, y: number) => void;
}) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<MeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/me?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else {
          setError(null);
          setData(d);
        }
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [days]);

  // data for another period is still shown (dimmed) while the new one loads
  const loading = !error && (!data || data.days !== days);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="glass p-5 text-sm text-[var(--coral)]">Couldn’t load your stats: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-8">
        <Skeleton className="h-20" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { totals, stages, impact, effort } = data;
  const delta = impact.completed - impact.completedPrev;
  const mixData = (["urgent", "high", "normal", "low"] as const)
    .map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: impact.priorityMix[k], color: PRIORITY_COLOR[k] }))
    .filter((d) => d.value > 0);

  return (
    <div className={`mx-auto max-w-6xl space-y-3 px-4 py-4 transition-opacity sm:space-y-5 sm:px-8 sm:py-8 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
      {/* identity + period */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {data.user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.user.avatar} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full text-xl font-semibold text-slate-900" style={{ background: "linear-gradient(135deg,#7df0d0,#a99bff)" }}>
              {data.user.name[0]?.toUpperCase()}
            </span>
          )}
          <div>
            <h2 className="text-3xl font-light tracking-tight">{data.user.name}</h2>
            <p className="text-sm text-[var(--muted)]">
              In {data.projectCount} project{data.projectCount === 1 ? "" : "s"} · {totals.assigned} tasks assigned to you
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Time period">
          {PERIODS.map((p) => (
            <button key={p} className="chip" aria-pressed={days === p} onClick={() => setDays(p)}>
              Last {p} days
            </button>
          ))}
        </div>
      </header>

      {/* headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi
          label="My projects"
          value={data.projectCount}
          sub={
            data.projects.slice(0, 2).map((p) => p.name).join(", ") +
            (data.projectCount > 2 ? ` +${data.projectCount - 2} more` : "")
          }
          accent="var(--violet)"
          hint={data.projects.map((p) => `${p.name} (${p.space})`).join("\n")}
        />
        <Kpi
          label="Completed"
          value={impact.completed}
          sub={`vs ${impact.completedPrev} in the previous ${data.days} days`}
          accent="var(--teal)"
          badge={delta === 0 ? null : { text: `${delta > 0 ? "+" : ""}${delta}`, good: delta > 0 }}
        />
        <Kpi
          label="Impact points"
          value={impact.points}
          sub="urgent ×4 · high ×3 · normal ×2 · low ×1"
          accent="var(--amber)"
          hint="Each completed task in the period earns points by its priority. It rewards finishing important work, not just lots of work."
        />
        <Kpi
          label="Needs attention"
          value={totals.overdueOpen}
          sub={`${totals.dueSoon} more due in 7 days`}
          accent={totals.overdueOpen ? "var(--coral)" : "var(--teal)"}
        />
      </div>

      {/* where I work + what stands out */}
      <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-5">
        <Section title="Where I work" hint={`${data.projectCount} project${data.projectCount === 1 ? "" : "s"} · where you have tasks`} className="lg:col-span-3">
          <WhereIWork data={data} projects={projects} onSelect={onSelect} />
        </Section>
        <Section title="Highlights" className="lg:col-span-2">
          <ul className="space-y-3 text-sm leading-relaxed">
            {data.insights.map((s, i) => (
              <motion.li key={i} className="flex gap-3" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--violet)" }} />
                {s}
              </motion.li>
            ))}
          </ul>
          <button
            onClick={() => onAsk(`Summarize my last ${data.days} days: what I delivered, what is stuck in my backlog and what I should focus on next.`)}
            className="mt-5 rounded-full px-5 py-2 text-sm font-medium text-slate-900"
            style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}
          >
            Ask the assistant for a summary
          </button>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-5">
        {/* where my work stands */}
        <Section title="Where my work stands" hint={`${totals.completionRate}% of all my tasks are done`} className="lg:col-span-3">
          <StageBar backlog={stages.backlog} inProgress={stages.inProgress} done={stages.done} />
          {data.openByStatus.length > 0 && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-3 text-xs text-[var(--muted)]">Open tasks by status</p>
                <Donut data={data.openByStatus.slice(0, 6)} center={`${totals.open}`} size={116} />
              </div>
              <div>
                <p className="mb-3 text-xs text-[var(--muted)]">Delivery quality</p>
                <ul className="space-y-3 text-sm">
                  <li className="flex justify-between">
                    <span className="text-[var(--muted)]">On-time rate</span>
                    <b className="font-medium" style={{ color: impact.onTimeRate === null ? undefined : impact.onTimeRate >= 80 ? "var(--teal)" : "var(--amber)" }}>
                      {impact.onTimeRate === null ? "Not enough dated tasks" : `${impact.onTimeRate}%`}
                    </b>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-[var(--muted)]">Typical time to finish</span>
                    <b className="font-medium">{impact.medianCycleDays === null ? "–" : `${impact.medianCycleDays} days`}</b>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-[var(--muted)]">Completion streak</span>
                    <b className="font-medium">
                      {data.streak.current} day{data.streak.current === 1 ? "" : "s"} <span className="text-xs font-normal text-[var(--muted)]">(best {data.streak.best})</span>
                    </b>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </Section>

        <Section title="My backlog" hint={`${stages.backlog} item${stages.backlog === 1 ? "" : "s"}`} className="lg:col-span-2">
          {data.backlog.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing waiting in your backlog. Nice.</p>
          ) : (
            <ul className="space-y-3">
              {data.backlog.map((t) => (
                <li key={t.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority ?? ""] ?? "var(--muted)" }} title={t.priority ?? "no priority"} />
                  <span className="min-w-0 flex-1">
                    <a href={t.url} target="_blank" rel="noreferrer" className="block truncate hover:underline">
                      {t.name}
                    </a>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {t.path} / {t.list} · waiting {t.ageDays}d
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* impact over time */}
      <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-5">
        <Section title="Output, last 8 weeks" hint="completed vs created" className="lg:col-span-3">
          <ColumnChart
            data={data.weekly.map((w) => ({ label: weekLabel(w.start), value: w.completed, value2: w.created }))}
            color="var(--teal)"
            color2="var(--violet)"
          />
          <p className="mt-3 flex gap-4 text-[11px] text-[var(--muted)]">
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--teal)" }} />
              Completed
            </span>
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--violet)", opacity: 0.55 }} />
              New tasks assigned
            </span>
          </p>
        </Section>
        <Section title="Consistency" hint="last 12 weeks" className="lg:col-span-2">
          <Heatmap days={data.heat} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-5">
        <Section title="What I delivered" hint={`last ${data.days} days`} className="lg:col-span-2">
          {mixData.length ? <Bars data={mixData} /> : <p className="text-sm text-[var(--muted)]">No completed tasks in this period.</p>}
          <p className="mt-4 text-xs text-[var(--muted)]">Completed tasks by priority.</p>
        </Section>

        <Section title="Effort" hint={effort.tracked ? `${effort.hours} h logged` : "time tracking"} className="lg:col-span-3">
          {effort.tracked ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs text-[var(--muted)]">Hours per day</p>
                <ColumnChart data={effort.daily.map((d) => ({ label: d.date.slice(8), value: d.hours }))} color="var(--amber)" height={90} />
              </div>
              <div>
                <p className="mb-3 text-xs text-[var(--muted)]">Where the time went (hours)</p>
                <Bars data={effort.byProject} />
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              No tracked time in this period. Start a timer on a task in ClickUp and your hours will show up here, by day and by project.
            </p>
          )}
        </Section>
      </div>

      <NotificationSettings />

      {/* Support link: shows the phone's real screen measurements (used to fix layout problems on a specific device) */}
      <div className="space-y-2 pt-2">
        <AccountFooter />
        <p className="text-center text-xs">
          <Link href="/debug-viewport" className="text-[var(--muted)] underline underline-offset-2">
            Screen check
          </Link>
        </p>
      </div>
    </div>
  );
}

// workspace > space > folder > project, for the places where I actually have tasks
function WhereIWork({ data, projects, onSelect }: { data: MeStats; projects: Project[] | null; onSelect: (p: Project, x: number, y: number) => void }) {
  const known = new Map((projects ?? []).map((p) => [p.id, p]));
  let n = 0;
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-md text-[11px] font-semibold text-slate-900" style={{ background: "linear-gradient(135deg,#7df0d0,#a99bff)" }}>
          {data.workspace[0]?.toUpperCase()}
        </span>
        <span className="font-medium">{data.workspace}</span>
        <span className="text-[11px] uppercase tracking-widest text-[var(--muted)]">Workspace</span>
      </div>

      <ul className="ml-3 mt-3 space-y-5 border-l border-[rgb(var(--tint)/0.14)] pl-5">
        {data.tree.map((s) => (
          <li key={s.space}>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: "var(--violet)" }} />
              <span className="font-medium">{s.space}</span>
              <span className="text-[11px] uppercase tracking-widest text-[var(--muted)]">Space</span>
            </div>

            <ul className="ml-1 mt-3 space-y-4 border-l border-[rgb(var(--tint)/0.1)] pl-5">
              {s.folders.map((f) => (
                <li key={f.name ?? "_"}>
                  {f.name && (
                    <div className="mb-2 flex items-center gap-2 text-[var(--muted)]">
                      <span aria-hidden>▸</span>
                      <span>{f.name}</span>
                      <span className="text-[11px] uppercase tracking-widest">Folder</span>
                    </div>
                  )}
                  <ul className="space-y-3">
                    {f.projects.map((p) => {
                      const full = known.get(p.id);
                      const idx = n++;
                      const body = (
                        <>
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate">{p.name}</span>
                            <span className="shrink-0 text-xs text-[var(--muted)]">
                              {p.done}/{p.assigned} done · {p.open} open
                            </span>
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]">
                            <motion.span
                              className="block h-full rounded-full"
                              style={{ background: "linear-gradient(90deg,var(--teal),var(--violet))" }}
                              initial={{ width: 0 }}
                              animate={{ width: `${p.progress}%` }}
                              transition={{ duration: 0.8, delay: idx * 0.06, ease: "easeOut" }}
                            />
                          </span>
                        </>
                      );
                      return (
                        <li key={p.id}>
                          {full ? (
                            <button
                              onClick={(e) => onSelect(full, e.clientX, e.clientY)}
                              className="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left hover:bg-[rgb(var(--tint)/0.06)]"
                              title="Open project"
                            >
                              {body}
                            </button>
                          ) : (
                            <div className="px-0 py-1.5">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
