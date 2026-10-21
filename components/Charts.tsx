"use client";

import { motion } from "motion/react";
import type { Chart, Datum } from "@/lib/charts";

const PALETTE = ["var(--violet)", "var(--teal)", "var(--amber)", "var(--coral)", "#6fb7ff", "#c58bff", "#8fe388"];
const colorOf = (d: Datum, i: number) => d.color ?? PALETTE[i % PALETTE.length];

// Every value is also printed as text, so colour is never the only signal.
export function Donut({ data, center, size = 132 }: { data: Datum[]; center?: string; size?: number }) {
  const total = data.reduce((n, d) => n + d.value, 0) || 1;
  const r = 46;
  const C = 2 * Math.PI * r;
  const starts = data.reduce<number[]>((acc, d, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (data[i - 1].value / total) * C], []);
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Status breakdown">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--tint)/0.08)" strokeWidth="12" />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          return (
            <motion.circle
              key={d.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={colorOf(d, i)}
              strokeWidth="12"
              strokeLinecap="butt"
              transform="rotate(-90 60 60)"
              strokeDashoffset={-starts[i]}
              initial={{ strokeDasharray: `0 ${C}` }}
              animate={{ strokeDasharray: `${Math.max(len - 1.5, 0)} ${C}` }}
              transition={{ duration: 0.9, delay: i * 0.12, ease: "easeOut" }}
            />
          );
        })}
        {center && (
          <text x="60" y="66" textAnchor="middle" fontSize="20" fontWeight="300" fill="var(--fg)">
            {center}
          </text>
        )}
      </svg>
      <ul className="space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: colorOf(d, i) }} />
            <span className="text-[var(--muted)]">{d.label}</span>
            <b className="ml-auto pl-3 font-medium">{d.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Bars({ data }: { data: Datum[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[88px_1fr_28px] items-center gap-3 text-xs">
          <span className="truncate text-[var(--muted)]">{d.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]">
            <motion.span
              className="block h-full rounded-full"
              style={{ background: colorOf(d, i) }}
              initial={{ width: 0 }}
              animate={{ width: `${(d.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: i * 0.07, ease: "easeOut" }}
            />
          </span>
          <b className="text-right font-medium">{d.value}</b>
        </li>
      ))}
    </ul>
  );
}

export function Stats({ data }: { data: Datum[] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {data.map((d, i) => (
        <motion.div
          key={d.label}
          className="rounded-xl bg-[rgb(var(--tint)/0.05)] p-3 text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
        >
          <div className="text-2xl font-light" style={{ color: d.value ? d.color : "var(--muted)" }}>
            {d.value}
          </div>
          <div className="text-[11px] text-[var(--muted)]">{d.label}</div>
        </motion.div>
      ))}
    </div>
  );
}

export function ChartCards({ charts }: { charts: Chart[] }) {
  return (
    <div className="grid gap-3 sm:mr-12 sm:grid-cols-2">
      {charts.map((c, i) => (
        <motion.div
          key={i}
          className={`glass p-4 ${c.kind === "stats" ? "sm:col-span-2" : ""}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + i * 0.12 }}
        >
          <p className="mb-3 text-[11px] uppercase tracking-widest text-[var(--muted)]">{c.title}</p>
          {c.kind === "donut" && <Donut data={c.data} center={c.center} />}
          {c.kind === "bars" && <Bars data={c.data} />}
          {c.kind === "stats" && <Stats data={c.data} />}
        </motion.div>
      ))}
    </div>
  );
}
