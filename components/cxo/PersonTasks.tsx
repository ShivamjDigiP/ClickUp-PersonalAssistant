"use client";

import { useMemo, useState } from "react";
import type { Deadline, PersonWork } from "@/lib/analytics/personWork";
import type { TaskStage } from "@/lib/analytics/types";
import { dateText, Section } from "./ui";

// Every task the developer holds in the period: where it sits (project), what state it is in (the tool's own status
// names), and a link to open it. The matrix answers "how much of what, where"; the list answers "which ones".
const STAGE_COLOR: Record<TaskStage, string> = { todo: "var(--muted)", doing: "var(--amber)", review: "var(--violet)", done: "var(--teal)" };
const DEADLINE: Record<Exclude<Deadline, null>, { label: (ms: number) => string; color: string }> = {
  on_time: { label: (ms) => `on time · due ${dateText(ms)}`, color: "var(--teal)" },
  late: { label: (ms) => `late · was due ${dateText(ms)}`, color: "var(--coral)" },
  overdue: { label: (ms) => `overdue · due ${dateText(ms)}`, color: "var(--coral)" },
  due: { label: (ms) => `due ${dateText(ms)}`, color: "var(--muted)" },
};
const PAGE = 12;
const ALL = "";

export function StatusPill({ status, stage }: { status: string; stage: TaskStage }) {
  const color = STAGE_COLOR[stage];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] capitalize" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}

function FilterChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="chip inline-flex items-center gap-1.5 capitalize">
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {label} <span className="tabular-nums text-[var(--muted)]">{count}</span>
    </button>
  );
}

export function PersonTasks({ tasks, rangeText }: { tasks: PersonWork["tasks"]; rangeText: string }) {
  const [status, setStatus] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [hideSub, setHideSub] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const statuses = tasks.byStatus.map((s) => s.status);

  const visible = useMemo(() => tasks.items.filter((t) => (!status || t.status === status) && (!project || t.project === project) && (!hideSub || !t.subtask)), [tasks.items, status, project, hideSub]);
  const pick = (set: (v: string) => void, value: string) => {
    set(value);
    setShown(PAGE);
  };

  if (tasks.total === 0) return <Section title="Tasks" hint={rangeText}><p className="text-sm text-[var(--muted)]">No tasks assigned, finished or open in this period.</p></Section>;

  return (
    <Section title="Tasks" hint={`${rangeText} · assigned, finished or still open`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
            <tr>
              <th className="pb-2 font-normal">Project</th>
              {statuses.map((s) => <th key={s} className="pb-2 text-right font-normal">{s}</th>)}
              <th className="pb-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {tasks.byProject.map((p) => (
              <tr key={p.project} className="border-t border-[var(--glass-border)]">
                <td className="py-2.5 pr-3"><button onClick={() => pick(setProject, project === p.project ? ALL : p.project)} className="text-left hover:underline">{p.project}</button></td>
                {statuses.map((s) => <td key={s} className="py-2.5 text-right tabular-nums">{p.statuses[s] ? <button onClick={() => { pick(setProject, p.project); setStatus(s); }} className="hover:underline">{p.statuses[s]}</button> : <span className="text-[var(--muted)]">–</span>}</td>)}
                <td className="py-2.5 text-right font-medium tabular-nums">{p.total}</td>
              </tr>
            ))}
            {tasks.byProject.length > 1 && (
              <tr className="border-t border-[var(--glass-border)] text-[var(--muted)]">
                <td className="py-2.5">All projects</td>
                {tasks.byStatus.map((s) => <td key={s.status} className="py-2.5 text-right tabular-nums">{s.count}</td>)}
                <td className="py-2.5 text-right font-medium tabular-nums text-[var(--fg)]">{tasks.total}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter tasks by status">
        <FilterChip label="All" count={tasks.byProject.filter((p) => !project || p.project === project).reduce((n, p) => n + p.total, 0)} active={!status} onClick={() => pick(setStatus, ALL)} />
        {tasks.byStatus.map((s) => {
          const count = project ? (tasks.byProject.find((p) => p.project === project)?.statuses[s.status] ?? 0) : s.count;
          return count > 0 && <FilterChip key={s.status} label={s.status} count={count} color={STAGE_COLOR[s.stage]} active={status === s.status} onClick={() => pick(setStatus, status === s.status ? ALL : s.status)} />;
        })}
        {project && <button onClick={() => pick(setProject, ALL)} className="chip">Project: {project} ✕</button>}
        {tasks.subtasks > 0 && <button onClick={() => { setHideSub((v) => !v); setShown(PAGE); }} aria-pressed={hideSub} className="chip">Hide subtasks <span className="tabular-nums text-[var(--muted)]">{tasks.subtasks}</span></button>}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
            <tr><th className="pb-2 font-normal">Task</th><th className="pb-2 font-normal">Project</th><th className="pb-2 font-normal">Status</th><th className="pb-2 font-normal">Priority</th><th className="pb-2 font-normal">Assigned</th><th className="pb-2 font-normal">Finished</th><th className="pb-2 font-normal">Deadline</th></tr>
          </thead>
          <tbody>
            {visible.slice(0, shown).map((t) => (
              <tr key={t.id} className="border-t border-[var(--glass-border)] align-top">
                <td className="max-w-[340px] py-2.5 pr-3">
                  {t.url ? <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline" title="Open in the task tool">{t.title} <span aria-hidden className="text-[var(--muted)]">↗</span></a> : t.title}
                  {t.subtask && <span className="ml-2 rounded-full bg-[rgb(var(--tint)/0.1)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]" title="A subtask of another task">subtask</span>}
                  {!t.counted && <p className="mt-0.5 text-[11px] text-[var(--amber)]">Not in the rating: part of a bulk import</p>}
                </td>
                <td className="py-2.5 pr-3 text-[var(--muted)]">{t.project}</td>
                <td className="py-2.5 pr-3"><StatusPill status={t.status} stage={t.stage} /></td>
                <td className="py-2.5 pr-3 capitalize text-[var(--muted)]">{t.priority}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--muted)]">{dateText(t.createdAt)}</td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--muted)]">{t.doneAt ? dateText(t.doneAt) : "–"}</td>
                <td className="whitespace-nowrap py-2.5 text-xs" style={{ color: t.deadline ? DEADLINE[t.deadline].color : "var(--muted)" }}>{t.deadline && t.dueAt ? DEADLINE[t.deadline].label(t.dueAt) : "no due date"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="py-4 text-sm text-[var(--muted)]">No tasks match these filters.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>Showing {Math.min(shown, visible.length)} of {visible.length}{tasks.items.length < tasks.total ? ` (the ${tasks.items.length} most relevant of ${tasks.total})` : ""}</span>
        {shown < visible.length && <button onClick={() => setShown((n) => n + 50)} className="chip">Show more</button>}
      </div>
      {tasks.subtasks > 0 && <p className="mt-3 text-xs text-[var(--muted)]">{tasks.subtasks} of these {tasks.subtasks === 1 ? "is a subtask" : "are subtasks"}. ClickUp&apos;s board hides subtasks unless its Subtasks switch is on, so a board can show fewer tasks than this list.</p>}
      {tasks.notCounted > 0 && <p className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] px-3 py-2 text-xs">{tasks.notCounted} {tasks.notCounted === 1 ? "task was" : "tasks were"} created in a bulk import and closed or left untouched the same day. {tasks.notCounted === 1 ? "It is" : "They are"} listed here but left out of the rating, because the dates say nothing about when the work was done.</p>}
    </Section>
  );
}
