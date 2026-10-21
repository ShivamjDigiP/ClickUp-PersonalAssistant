"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { Flag } from "@/lib/projectFilters";

// Clickable charts. Clicking a status, person or tile filters the whole page.
// Each one shows all the options for ITS OWN filter, so you can always pick another or untick one.
export const PALETTE = ["var(--violet)", "var(--teal)", "var(--amber)", "var(--coral)", "#6fb7ff", "#c58bff", "#8fe388", "#ff9ed2"];

export function StatusFacet({
  items,
  selected,
  onToggle,
}: {
  items: { label: string; count: number }[];
  selected: string[];
  onToggle: (label: string) => void;
}) {
  const total = items.reduce((n, i) => n + i.count, 0);
  const R = 46;
  const C = 2 * Math.PI * R;
  const starts = items.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (items[i - 1].count / (total || 1)) * C], []);
  const hasSel = selected.length > 0;
  const center = hasSel ? items.filter((i) => selected.includes(i.label)).reduce((n, i) => n + i.count, 0) : total;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width="132" height="132" viewBox="0 0 120 120" role="img" aria-label="Tasks by status. Click a segment to filter.">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgb(var(--tint)/0.08)" strokeWidth="12" />
        {items.map((it, i) => {
          const on = selected.includes(it.label);
          const len = (it.count / (total || 1)) * C;
          return (
            <motion.circle
              key={it.label}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={on ? 15 : 12}
              transform="rotate(-90 60 60)"
              strokeDashoffset={-starts[i]}
              style={{ cursor: "pointer", opacity: hasSel && !on ? 0.28 : 1 }}
              initial={{ strokeDasharray: `0 ${C}` }}
              animate={{ strokeDasharray: `${Math.max(len - 1.5, 0)} ${C}` }}
              transition={{ duration: 0.7, delay: i * 0.08, ease: "easeOut" }}
              onClick={() => onToggle(it.label)}
            >
              <title>{`${it.label}: ${it.count}`}</title>
            </motion.circle>
          );
        })}
        <text x="60" y="64" textAnchor="middle" fontSize="20" fontWeight="300" fill="var(--fg)">
          {center}
        </text>
      </svg>

      <ul className="min-w-[10rem] flex-1 space-y-0.5 text-sm">
        {items.map((it, i) => {
          const on = selected.includes(it.label);
          return (
            <li key={it.label}>
              <button
                aria-pressed={on}
                onClick={() => onToggle(it.label)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[rgb(var(--tint)/0.07)] ${on ? "bg-[rgb(var(--tint)/0.12)]" : ""}`}
                style={{ opacity: hasSel && !on ? 0.55 : 1 }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="flex-1 truncate">{it.label}</span>
                <b className="font-medium tabular-nums">{it.count}</b>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type PersonItem = { key: string; name: string; count: number; open: number };

export function PeopleFacet({
  items,
  selected,
  onToggle,
  limit = 8,
}: {
  items: PersonItem[];
  selected: string[];
  onToggle: (key: string) => void;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const max = Math.max(...items.map((i) => i.count), 1);
  const hasSel = selected.length > 0;
  // selected people always stay visible, even if they're beyond the limit
  const shown = all ? items : items.filter((it, i) => i < limit || selected.includes(it.key));

  if (!items.length) return <p className="text-sm text-[var(--muted)]">No one matches the other filters.</p>;
  return (
    <div>
      <ul className="space-y-1">
        {shown.map((it, i) => {
          const on = selected.includes(it.key);
          return (
            <li key={it.key}>
              <button
                aria-pressed={on}
                onClick={() => onToggle(it.key)}
                title={`${it.name}: ${it.count} task${it.count === 1 ? "" : "s"}, ${it.open} open`}
                className={`grid w-full grid-cols-[110px_1fr_28px] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[rgb(var(--tint)/0.07)] ${on ? "bg-[rgb(var(--tint)/0.12)]" : ""}`}
                style={{ opacity: hasSel && !on ? 0.55 : 1 }}
              >
                <span className={`truncate ${it.key === "none" ? "italic text-[var(--muted)]" : ""}`}>{it.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{ background: it.key === "none" ? "var(--muted)" : PALETTE[i % PALETTE.length] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(it.count / max) * 100}%` }}
                    transition={{ duration: 0.6, delay: Math.min(i * 0.04, 0.4), ease: "easeOut" }}
                  />
                </span>
                <b className="text-right font-medium tabular-nums">{it.count}</b>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > limit && (
        <button className="chip mt-3" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

const FLAG_META: Record<Flag, { label: string; color: string }> = {
  overdue: { label: "Overdue", color: "var(--coral)" },
  soon: { label: "Due in 7 days", color: "var(--amber)" },
  stale: { label: "Stale 7d+", color: "var(--violet)" },
};

export function FlagTiles({
  counts,
  selected,
  onToggle,
}: {
  counts: Record<Flag, number>;
  selected: Flag[];
  onToggle: (f: Flag) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {(Object.keys(FLAG_META) as Flag[]).map((f) => {
        const on = selected.includes(f);
        const m = FLAG_META[f];
        return (
          <button
            key={f}
            aria-pressed={on}
            onClick={() => onToggle(f)}
            className="rounded-xl border p-3 text-center transition-colors hover:bg-[rgb(var(--tint)/0.07)]"
            style={{
              borderColor: on ? m.color : "transparent",
              background: on ? `color-mix(in srgb, ${m.color} 12%, transparent)` : "rgb(var(--tint)/0.05)",
              opacity: selected.length && !on ? 0.6 : 1,
            }}
          >
            <div className="text-2xl font-light tabular-nums" style={{ color: counts[f] ? m.color : "var(--muted)" }}>
              {counts[f]}
            </div>
            <div className="text-[11px] text-[var(--muted)]">{m.label}</div>
          </button>
        );
      })}
    </div>
  );
}

export const FLAG_LABEL = (f: Flag) => FLAG_META[f].label;
