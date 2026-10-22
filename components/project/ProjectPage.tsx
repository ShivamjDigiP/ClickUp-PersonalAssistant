"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { FlagTiles, PeopleFacet, StatusFacet, FLAG_LABEL, type PersonItem } from "./Facets";
import { FilterBar } from "./FilterBar";
import { TaskList } from "./TaskList";
import { Kpi, Skeleton, StageBar } from "../MeCharts";
import {
  DAY,
  EMPTY,
  NONE,
  activeCount,
  flagsOf,
  matches,
  sortTasks,
  toParams,
  toggle,
  type Filters,
  type Flag,
  type PTask,
  type Priority,
  type Stage,
} from "@/lib/projectFilters";
import type { ProjectTasks } from "@/app/api/project/[id]/tasks/route";

export type Origin = { x: number; y: number };

const HEALTH = { on_track: ["var(--teal)", "On track"], at_risk: ["var(--amber)", "At risk"], behind: ["var(--coral)", "Behind"] } as const;

function Card({ title, hint, children, className = "", flush = false }: { title: string; hint?: string; children: React.ReactNode; className?: string; flush?: boolean }) {
  // flush: the content (a table) runs edge to edge, so only the header gets padding
  return (
    <section className={`glass ${flush ? "pb-4" : "p-4 sm:p-5"} ${className}`}>
      <div className={`mb-3 flex items-baseline justify-between gap-3 sm:mb-4 ${flush ? "px-4 pt-4 sm:px-5 sm:pt-5" : ""}`}>
        <h2 className="text-[11px] uppercase tracking-widest text-[var(--muted)]">{title}</h2>
        {hint && <span className="text-[11px] text-[var(--muted)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

// Everything about one person in this project (ignores the other filters so the numbers are the person's full picture)
function PersonCard({ name, tasks, now }: { name: string; tasks: PTask[]; now: number }) {
  const open = tasks.filter((t) => t.stage !== "done");
  const done = tasks.filter((t) => t.stage === "done");
  const overdue = open.filter((t) => t.due && t.due < now).length;
  const recent = done.filter((t) => (t.closed ?? t.updated) >= now - 30 * DAY).length;
  const cycles = done.map((t) => ((t.closed ?? t.updated) - t.created) / DAY).filter((d) => d >= 0).sort((a, b) => a - b);
  const median = cycles.length ? cycles[Math.floor(cycles.length / 2)] : null;
  return (
    <motion.section className="glass p-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-widest text-[var(--muted)]">Focus: {name}</h2>
        <span className="text-[11px] text-[var(--muted)]">all their tasks in this project</span>
      </div>
      <StageBar
        backlog={tasks.filter((t) => t.stage === "backlog").length}
        inProgress={tasks.filter((t) => t.stage === "progress").length}
        done={done.length}
      />
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        {[
          ["Assigned", tasks.length, undefined],
          ["Overdue", overdue, overdue ? "var(--coral)" : undefined],
          ["Done in last 30 days", recent, recent ? "var(--teal)" : undefined],
          ["Typical time to finish", median === null ? "–" : `${median.toFixed(1)} d`, undefined],
        ].map(([label, value, color]) => (
          <div key={label as string}>
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="mt-0.5 text-2xl font-light tabular-nums" style={{ color: color as string | undefined }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </motion.section>
  );
}

export function ProjectPage({
  id,
  name,
  mode,
  color = "var(--violet)",
  origin,
  initialFilters,
  onClose,
  onAsk,
}: {
  id: string;
  name: string;
  mode: "overlay" | "page";
  color?: string;
  origin?: Origin;
  initialFilters?: Filters;
  onClose?: () => void;
  onAsk?: (q: string) => void;
}) {
  const [data, setData] = useState<ProjectTasks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters ?? EMPTY);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let off = false;
    fetch(`/api/project/${id}/tasks`)
      .then((r) => r.json())
      .then((d) => !off && (d.error ? setError(d.error) : setData(d)))
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [id]);

  // Keep the filters in the address bar so a filtered view can be shared or reloaded
  useEffect(() => {
    const qs = toParams(filters).toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "");
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", url);
  }, [filters]);

  useEffect(() => {
    if (mode !== "overlay" || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="listbox"]') && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const reset = () => setFilters(EMPTY);
  const nActive = activeCount(filters);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const filtered = useMemo(() => tasks.filter((t) => matches(t, filters, now)), [tasks, filters, now]);
  const sorted = useMemo(() => sortTasks(filtered, filters.sort), [filtered, filters.sort]);

  // Facets: each chart counts tasks under every filter EXCEPT its own, so all its options stay visible
  const facets = useMemo(() => {
    const skip = (d: Parameters<typeof matches>[3]) => tasks.filter((t) => matches(t, filters, now, d));
    const order = new Map((data?.statuses ?? []).map((s, i) => [s.status, i]));
    const byStatus = new Map<string, number>();
    for (const t of skip("statuses")) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    for (const s of filters.statuses) if (!byStatus.has(s)) byStatus.set(s, 0);
    const statuses = [...byStatus].map(([label, count]) => ({ label, count })).sort((a, b) => (order.get(a.label) ?? 99) - (order.get(b.label) ?? 99));

    const ppl = new Map<string, PersonItem>();
    for (const t of skip("people")) {
      for (const a of t.assignees.length ? t.assignees : [{ id: NONE as unknown as number, name: "Unassigned" }]) {
        const key = t.assignees.length ? String(a.id) : NONE;
        const p = ppl.get(key) ?? { key, name: a.name, count: 0, open: 0 };
        p.count++;
        if (t.stage !== "done") p.open++;
        ppl.set(key, p);
      }
    }
    const people = [...ppl.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const stageCounts: Record<Stage, number> = { backlog: 0, progress: 0, done: 0 };
    for (const t of skip("stages")) stageCounts[t.stage]++;
    const priorityCounts: Record<Priority, number> = { urgent: 0, high: 0, normal: 0, low: 0, none: 0 };
    for (const t of skip("priorities")) priorityCounts[t.priority]++;
    const flagCounts: Record<Flag, number> = { overdue: 0, soon: 0, stale: 0 };
    for (const t of skip("flags")) for (const f of flagsOf(t, now)) flagCounts[f]++;
    return { statuses, people, stageCounts, priorityCounts, flagCounts };
  }, [tasks, filters, now, data]);

  const nameOf = (key: string) => (key === NONE ? "Unassigned" : (facets.people.find((p) => p.key === key)?.name ?? tasks.flatMap((t) => t.assignees).find((a) => String(a.id) === key)?.name ?? "Person"));

  // The little chips under the filter bar; each can be removed on its own
  const chips: { label: string; remove: () => void }[] = [
    ...(filters.q.trim() ? [{ label: `Search: “${filters.q.trim()}”`, remove: () => set({ q: "" }) }] : []),
    ...filters.statuses.map((s) => ({ label: `Status: ${s}`, remove: () => set({ statuses: toggle(filters.statuses, s) }) })),
    ...filters.people.map((p) => ({ label: `Person: ${nameOf(p)}`, remove: () => set({ people: toggle(filters.people, p) }) })),
    ...filters.stages.map((s) => ({ label: `Stage: ${s === "progress" ? "In progress" : s[0].toUpperCase() + s.slice(1)}`, remove: () => set({ stages: toggle(filters.stages, s) }) })),
    ...filters.priorities.map((p) => ({ label: `Priority: ${p}`, remove: () => set({ priorities: toggle(filters.priorities, p) }) })),
    ...filters.flags.map((f) => ({ label: FLAG_LABEL(f), remove: () => set({ flags: toggle(filters.flags, f) }) })),
  ];

  // Header numbers follow the filters
  const total = tasks.length;
  const open = tasks.filter((t) => t.stage !== "done");
  const overdueAll = open.filter((t) => t.due && t.due < now).length;
  const health = !open.length || !overdueAll ? "on_track" : overdueAll / open.length < 0.3 ? "at_risk" : "behind";
  const [hColor, hLabel] = HEALTH[health];
  const fDone = filtered.filter((t) => t.stage === "done").length;
  const fOpen = filtered.length - fDone;
  const fOverdue = filtered.filter((t) => flagsOf(t, now).includes("overdue")).length;
  const progress = filtered.length ? Math.round((fDone / filtered.length) * 100) : 0;
  const C = 2 * Math.PI * 52;

  const single = filters.people.length === 1 ? filters.people[0] : null;
  const personTasks = single ? tasks.filter((t) => (single === NONE ? t.assignees.length === 0 : t.assignees.some((a) => String(a.id) === single))) : [];

  const project = data?.project;
  const crumb = project ? [project.space, project.folder].filter(Boolean).join(" / ") : "";
  const reach = useMemo(() => (typeof window === "undefined" ? 2000 : Math.hypot(window.innerWidth, window.innerHeight) + 40), []);

  const body = (
    <div className="mx-auto max-w-6xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-8 sm:pb-16 sm:pt-6">
      <div className="flex items-center justify-between gap-3">
        {mode === "overlay" ? (
          <button onClick={onClose} className="glass rounded-full px-4 py-2 text-sm">
            ← Back
          </button>
        ) : (
          <Link href="/" className="glass rounded-full px-4 py-2 text-sm">
            ← Back to Home
          </Link>
        )}
        {mode === "overlay" && onAsk && (
          <button
            onClick={() => {
              onClose?.();
              onAsk(`Give me a summary of ${name}${chips.length ? `, focusing on: ${chips.map((c) => c.label).join("; ")}` : ""}. What is at risk and what should I do next?`);
            }}
            className="rounded-full px-5 py-2 text-sm font-medium text-slate-900"
            style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}
          >
            Ask the assistant about this
          </button>
        )}
      </div>

      {/* title + progress ring (follows the filters) */}
      <motion.header className="mt-4 flex items-center gap-4 sm:mt-7 sm:gap-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="relative h-20 w-20 shrink-0 sm:h-28 sm:w-28">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgb(var(--tint)/0.1)" strokeWidth="8" />
            <motion.circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={data ? hColor : color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              animate={{ strokeDashoffset: C * (1 - (data ? progress : 0) / 100) }}
              initial={{ strokeDashoffset: C }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-lg font-light sm:text-2xl">{data ? `${progress}%` : "…"}</div>
        </div>
        <div className="min-w-0">
          {crumb && <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{crumb}</p>}
          <h1 className="text-2xl font-light leading-tight tracking-tight sm:truncate sm:text-4xl">{project?.name ?? name}</h1>
          {data && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm" style={{ color: hColor }}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: hColor }} />
                {hLabel}
              </span>
              <span className="text-[var(--muted)]">
                {fDone} of {filtered.length} {nActive ? "matching " : ""}tasks done
                {nActive > 0 && ` · ${total} in project`}
              </span>
            </p>
          )}
        </div>
      </motion.header>

      {error && <p className="glass mt-8 p-5 text-sm text-[var(--coral)]">Couldn’t load this project: {error}</p>}
      {!data && !error && (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-14" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {data && (
        <>
          {/* filters stay in view while you scroll */}
          <div className="z-20 -mx-4 mt-4 border-b border-[rgb(var(--tint)/0.08)] px-4 py-2 backdrop-blur-md sm:-mx-8 sm:mt-6 sm:px-8 sm:py-3 md:sticky md:top-0" style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}>
            <FilterBar
              filters={filters}
              set={set}
              people={facets.people}
              stageCounts={facets.stageCounts}
              priorityCounts={facets.priorityCounts}
              activeCount={nActive}
              onReset={reset}
            />
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
                {chips.map((c) => (
                  <button key={c.label} onClick={c.remove} className="chip flex items-center gap-1.5" title="Remove this filter">
                    {c.label} <span aria-hidden>✕</span>
                  </button>
                ))}
                <button onClick={reset} className="text-xs text-[var(--coral)] underline-offset-2 hover:underline">
                  Clear all
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-4">
            <Kpi label={nActive ? "Matching tasks" : "Tasks"} value={filtered.length} sub={nActive ? `of ${total} in the project` : `${fOpen} open · ${fDone} done`} accent="var(--violet)" />
            <Kpi label="Open" value={fOpen} sub={nActive ? "in this view" : "not done yet"} accent="var(--amber)" />
            <Kpi label="Done" value={fDone} sub={filtered.length ? `${progress}% of this view` : "–"} accent="var(--teal)" />
            <Kpi label="Overdue" value={fOverdue} sub={fOverdue ? "open and past due" : "nothing overdue here"} accent={fOverdue ? "var(--coral)" : "var(--teal)"} />
          </div>

          {single && (
            <div className="mt-5">
              <PersonCard name={nameOf(single)} tasks={personTasks} now={now} />
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:mt-5 sm:gap-5 lg:grid-cols-2">
            <Card title="By status" hint="click to filter">
              <StatusFacet items={facets.statuses} selected={filters.statuses} onToggle={(s) => set({ statuses: toggle(filters.statuses, s) })} />
            </Card>
            <Card title="Tasks per person" hint="click to filter">
              <PeopleFacet items={facets.people} selected={filters.people} onToggle={(k) => set({ people: toggle(filters.people, k) })} />
            </Card>
            <Card title="What needs attention" hint="click to filter" className="lg:col-span-2">
              <FlagTiles counts={facets.flagCounts} selected={filters.flags} onToggle={(f) => set({ flags: toggle(filters.flags, f) })} />
            </Card>
          </div>

          <Card title={nActive ? `Tasks · ${sorted.length} match` : `Tasks · ${total}`} hint={data.truncated ? "showing the first 1000 tasks" : undefined} className="mt-3 sm:mt-5" flush>
            <div className="px-2 sm:px-3">
              <TaskList
                tasks={sorted}
                now={now}
                selectedStatuses={filters.statuses}
                selectedPeople={filters.people}
                onToggleStatus={(s) => set({ statuses: toggle(filters.statuses, s) })}
                onTogglePerson={(k) => set({ people: toggle(filters.people, k) })}
                onReset={reset}
                filtered={nActive > 0}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );

  if (mode === "page") return <div className="min-h-dvh">{body}</div>;

  const at = `${origin?.x ?? 0}px ${origin?.y ?? 0}px`;
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed z-40 rounded-full"
        style={{ left: (origin?.x ?? 0) - 40, top: (origin?.y ?? 0) - 40, width: 80, height: 80, background: `radial-gradient(circle, ${color}, transparent 70%)` }}
        initial={{ scale: 0.6, opacity: 0.9 }}
        animate={{ scale: reach / 30, opacity: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <motion.div
        role="dialog"
        aria-label={`${name} details`}
        className="fixed fill-screen z-40 overflow-y-auto overflow-x-hidden"
        style={{
          background: "var(--bg)",
          backgroundImage: `radial-gradient(900px 500px at 15% -10%, color-mix(in srgb, ${color} 20%, transparent), transparent 60%), radial-gradient(900px 500px at 100% 110%, var(--g1), transparent 60%)`,
        }}
        initial={{ clipPath: `circle(0px at ${at})` }}
        animate={{ clipPath: `circle(${reach}px at ${at})` }}
        exit={{ clipPath: `circle(0px at ${at})` }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      >
        {body}
      </motion.div>
    </>
  );
}
