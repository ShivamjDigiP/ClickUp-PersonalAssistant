"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Orb } from "./Orb";

type Entry = { at: string; event: string; tool: string; summary: string; detail?: string };

const STYLE: Record<string, { color: string; label: string }> = {
  proposed: { color: "var(--violet)", label: "Proposed" },
  approved: { color: "var(--amber)", label: "Approved" },
  executed: { color: "var(--teal)", label: "Executed" },
  rejected: { color: "var(--coral)", label: "Rejected" },
  failed: { color: "var(--coral)", label: "Failed" },
  blocked: { color: "var(--coral)", label: "Blocked" },
  expired: { color: "var(--muted)", label: "Expired" },
};

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function ActivityView({ light }: { light: boolean }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/audit").then((r) => r.json()).then(setEntries);
  }, []);

  // Only offer filters that actually have entries, with counts
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries ?? []) c[e.event] = (c[e.event] ?? 0) + 1;
    return c;
  }, [entries]);

  const shown = (entries ?? []).filter((e) => filter === "all" || e.event === filter);
  const groups = shown.reduce<Record<string, Entry[]>>((acc, e) => ((acc[dayLabel(e.at)] ??= []).push(e), acc), {});

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6 sm:py-8">
      <h2 className="text-3xl font-light tracking-tight">Activity</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Every proposal, approval and change, in order.</p>

      {entries && entries.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter activity">
          <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All · {entries.length}
          </button>
          {Object.keys(STYLE)
            .filter((k) => counts[k])
            .map((k) => (
              <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: STYLE[k].color }} />
                {STYLE[k].label} · {counts[k]}
              </button>
            ))}
        </div>
      )}

      {entries && entries.length === 0 && (
        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <Orb size={96} three light={light} />
          <div>
            <p className="text-lg font-light">Nothing here yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--muted)]">
              When the assistant proposes a change and you approve or reject it, it shows up here as a timeline you can trust.
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 sm:mt-8">
        {Object.entries(groups).map(([day, list]) => (
          <section key={day} className="mb-8">
            <h3 className="mb-4 text-xs uppercase tracking-widest text-[var(--muted)]">{day}</h3>
            <ol className="relative space-y-3.5 border-l sm:space-y-5 border-[rgb(var(--tint)/0.12)] pl-7">
              {list.map((e, i) => {
                const s = STYLE[e.event] ?? STYLE.expired;
                return (
                  <motion.li
                    key={e.at + i}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.5), type: "spring", stiffness: 260, damping: 24 }}
                    className="relative"
                  >
                    <span
                      className="absolute -left-[35px] top-1.5 h-3 w-3 rounded-full ring-4 ring-[var(--bg)]"
                      style={{ background: s.color, boxShadow: e.event === "executed" ? `0 0 14px ${s.color}` : undefined }}
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm">
                        <b className="font-medium" style={{ color: s.color }}>
                          {s.label}
                        </b>{" "}
                        <span className="text-[var(--fg)]">{e.summary}</span>
                      </p>
                      <time className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
                        {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                    {e.detail && e.event !== "proposed" && <p className="mt-0.5 text-xs text-[var(--muted)]">{e.detail}</p>}
                  </motion.li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
