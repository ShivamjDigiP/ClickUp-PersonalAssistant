"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { DAY, NONE, flagsOf, type PTask, type Priority } from "@/lib/projectFilters";

const PRIORITY_COLOR: Record<Priority, string> = { urgent: "var(--coral)", high: "var(--coral)", normal: "var(--amber)", low: "var(--teal)", none: "var(--muted)" };
const STAGE_COLOR = { backlog: "var(--violet)", progress: "var(--amber)", done: "var(--teal)" } as const;

const ago = (ms: number, now: number) => {
  const d = Math.floor((now - ms) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`;
};
const dueLabel = (t: PTask, now: number) => {
  if (!t.due) return { text: "–", color: "var(--muted)" };
  const date = new Date(t.due).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const overdue = t.stage !== "done" && t.due < now;
  return { text: date, color: overdue ? "var(--coral)" : "var(--fg)" };
};

const PAGE = 40;

export function TaskList({
  tasks,
  now,
  selectedStatuses,
  selectedPeople,
  onToggleStatus,
  onTogglePerson,
  onReset,
  filtered,
}: {
  tasks: PTask[];
  now: number;
  selectedStatuses: string[];
  selectedPeople: string[];
  onToggleStatus: (s: string) => void;
  onTogglePerson: (key: string) => void;
  onReset: () => void;
  filtered: boolean;
}) {
  // growing the list is remembered per result set, and resets automatically when the filters change
  const [more, setMore] = useState<{ sig: string; n: number }>({ sig: "", n: PAGE });
  const sig = `${tasks.length}:${tasks[0]?.id}`;
  const limit = more.sig === sig ? more.n : PAGE;
  const shown = tasks.slice(0, limit);

  if (tasks.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-lg font-light">No tasks match these filters</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Try removing a filter, or start over.</p>
        {filtered && (
          <button onClick={onReset} className="mt-4 rounded-full border border-[var(--coral)] px-5 py-2 text-sm text-[var(--coral)]">
            ↺ Reset all filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,1fr)_130px_170px_90px_80px_90px] gap-3 px-3 pb-2 text-[11px] uppercase tracking-widest text-[var(--muted)] md:grid">
        <span>Task</span>
        <span>Status</span>
        <span>Assignee</span>
        <span>Priority</span>
        <span>Due</span>
        <span>Updated</span>
      </div>
      <ul className="divide-y divide-[rgb(var(--tint)/0.08)]">
        {shown.map((t, i) => {
          const due = dueLabel(t, now);
          const flags = flagsOf(t, now);
          const people = t.assignees.length ? t.assignees : [{ id: NONE as unknown as number, name: "Unassigned" }];
          return (
            <motion.li
              key={t.id}
              className="grid gap-x-3 gap-y-1.5 px-3 py-3 text-sm hover:bg-[rgb(var(--tint)/0.04)] md:grid-cols-[minmax(0,1fr)_130px_170px_90px_80px_90px] md:items-center"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.012, 0.25) }}
            >
              <div className="min-w-0">
                <a href={t.url} target="_blank" rel="noreferrer" className="block truncate hover:underline" title={t.name}>
                  {t.name}
                </a>
                {flags.length > 0 && (
                  <span className="mt-0.5 flex gap-2 text-[11px]">
                    {flags.includes("overdue") && <span style={{ color: "var(--coral)" }}>Overdue</span>}
                    {flags.includes("soon") && <span style={{ color: "var(--amber)" }}>Due soon</span>}
                    {flags.includes("stale") && <span style={{ color: "var(--violet)" }}>No update 7d+</span>}
                  </span>
                )}
              </div>

              <button
                onClick={() => onToggleStatus(t.status)}
                aria-pressed={selectedStatuses.includes(t.status)}
                title={`Filter by "${t.status}"`}
                className={`flex w-fit max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${selectedStatuses.includes(t.status) ? "border-[var(--violet)] bg-[rgb(var(--tint)/0.1)]" : "border-transparent bg-[rgb(var(--tint)/0.06)]"}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STAGE_COLOR[t.stage] }} />
                <span className="truncate">{t.status}</span>
              </button>

              <div className="flex flex-wrap gap-1">
                {people.map((a) => {
                  const key = t.assignees.length ? String(a.id) : NONE;
                  return (
                    <button
                      key={key}
                      onClick={() => onTogglePerson(key)}
                      aria-pressed={selectedPeople.includes(key)}
                      title={`Filter by ${a.name}`}
                      className={`max-w-[160px] truncate rounded-full px-2 py-0.5 text-xs ${selectedPeople.includes(key) ? "bg-[rgb(var(--tint)/0.16)]" : "bg-[rgb(var(--tint)/0.06)]"} ${key === NONE ? "italic text-[var(--muted)]" : ""}`}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>

              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} />
                <span className="capitalize" style={{ color: t.priority === "none" ? "var(--muted)" : undefined }}>
                  {t.priority === "none" ? "–" : t.priority}
                </span>
              </span>
              <span className="text-xs tabular-nums" style={{ color: due.color }}>
                {due.text}
              </span>
              <span className="text-xs text-[var(--muted)]">{ago(t.updated, now)}</span>
            </motion.li>
          );
        })}
      </ul>

      {tasks.length > limit && (
        <div className="flex items-center justify-center gap-3 pt-4 text-xs text-[var(--muted)]">
          Showing {limit} of {tasks.length}
          <button className="chip" onClick={() => setMore({ sig, n: limit + PAGE })}>
            Show {Math.min(PAGE, tasks.length - limit)} more
          </button>
          <button className="chip" onClick={() => setMore({ sig, n: tasks.length })}>
            Show all
          </button>
        </div>
      )}
    </div>
  );
}
