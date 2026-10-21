"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { NONE, toggle, type Filters, type Priority, type SortKey, type Stage } from "@/lib/projectFilters";
import type { PersonItem } from "./Facets";

const STAGES: { id: Stage; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "progress", label: "In progress" },
  { id: "done", label: "Done" },
];
const PRIORITIES: { id: Priority; label: string; color: string }[] = [
  { id: "urgent", label: "Urgent", color: "var(--coral)" },
  { id: "high", label: "High", color: "var(--coral)" },
  { id: "normal", label: "Normal", color: "var(--amber)" },
  { id: "low", label: "Low", color: "var(--teal)" },
  { id: "none", label: "No priority", color: "var(--muted)" },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: "due", label: "Due date" },
  { id: "priority", label: "Priority" },
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Newest" },
];

function PeopleSelect({ people, selected, onChange }: { people: PersonItem[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const list = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={box} className="relative">
      <button className="chip flex items-center gap-2" aria-haspopup="listbox" aria-expanded={open} aria-pressed={selected.length > 0} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden>👤</span>
        {selected.length === 0 ? "Everyone" : selected.length === 1 ? (people.find((p) => p.key === selected[0])?.name ?? "1 person") : `${selected.length} people`}
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="glass absolute left-0 top-full z-30 mt-2 w-64 p-2"
            style={{ background: "var(--bg)" }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a person…"
              className="mb-2 w-full rounded-lg bg-[rgb(var(--tint)/0.07)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)]"
            />
            <ul role="listbox" aria-multiselectable className="scroll-fade max-h-64 overflow-y-auto">
              {list.map((p) => {
                const on = selected.includes(p.key);
                return (
                  <li key={p.key}>
                    <button
                      role="option"
                      aria-selected={on}
                      onClick={() => onChange(toggle(selected, p.key))}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[rgb(var(--tint)/0.07)]"
                    >
                      <span className={`grid h-4 w-4 place-items-center rounded border text-[10px] ${on ? "border-[var(--violet)] bg-[var(--violet)] text-white" : "border-[rgb(var(--tint)/0.3)]"}`}>{on ? "✓" : ""}</span>
                      <span className={`flex-1 truncate ${p.key === NONE ? "italic text-[var(--muted)]" : ""}`}>{p.name}</span>
                      <span className="text-xs tabular-nums text-[var(--muted)]">{p.count}</span>
                    </button>
                  </li>
                );
              })}
              {list.length === 0 && <li className="px-3 py-2 text-sm text-[var(--muted)]">No match</li>}
            </ul>
            {selected.length > 0 && (
              <button className="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[rgb(var(--tint)/0.07)]" onClick={() => onChange([])}>
                Clear people
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FilterBar({
  filters,
  set,
  people,
  stageCounts,
  priorityCounts,
  activeCount,
  onReset,
}: {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  people: PersonItem[];
  stageCounts: Record<Stage, number>;
  priorityCounts: Record<Priority, number>;
  activeCount: number;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search tasks, status, people…"
          aria-label="Search tasks"
          className="glass h-9 w-56 rounded-full pl-4 pr-8 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--violet)]"
        />
        {filters.q && (
          <button aria-label="Clear search" onClick={() => set({ q: "" })} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] hover:text-[var(--fg)]">
            ✕
          </button>
        )}
      </div>

      <PeopleSelect people={people} selected={filters.people} onChange={(v) => set({ people: v })} />

      <div className="flex items-center gap-1.5" role="group" aria-label="Stage">
        {STAGES.map((s) => (
          <button key={s.id} className="chip" aria-pressed={filters.stages.includes(s.id)} onClick={() => set({ stages: toggle(filters.stages, s.id) })}>
            {s.label} <span className="opacity-60">{stageCounts[s.id]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Priority">
        {PRIORITIES.filter((p) => priorityCounts[p.id] > 0 || filters.priorities.includes(p.id)).map((p) => (
          <button key={p.id} className="chip" aria-pressed={filters.priorities.includes(p.id)} onClick={() => set({ priorities: toggle(filters.priorities, p.id) })}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: p.color }} />
            {p.label} <span className="opacity-60">{priorityCounts[p.id]}</span>
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          Sort
          <select
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as SortKey })}
            className="glass h-9 rounded-full bg-transparent px-3 text-xs text-[var(--fg)] outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id} className="text-black">
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onReset}
          disabled={activeCount === 0}
          className="h-9 rounded-full border border-[var(--coral)] px-4 text-xs font-medium text-[var(--coral)] transition-opacity hover:bg-[color-mix(in_srgb,var(--coral)_12%,transparent)] disabled:cursor-default disabled:opacity-35"
          title="Clear every filter at once"
        >
          ↺ Reset{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>
    </div>
  );
}
