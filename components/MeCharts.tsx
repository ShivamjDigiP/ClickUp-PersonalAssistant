"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";

// Numbers count up from zero when they appear
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: "easeOut" });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span>{text}</motion.span>;
}

export function Kpi({
  label,
  value,
  decimals,
  suffix,
  sub,
  accent = "var(--fg)",
  badge,
  hint,
}: {
  label: string;
  value: number | null;
  decimals?: number;
  suffix?: string;
  sub?: string;
  accent?: string;
  badge?: { text: string; good: boolean } | null;
  hint?: string;
}) {
  return (
    <motion.div className="glass p-3 sm:p-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} title={hint}>
      <p className="text-[10px] uppercase tracking-widest text-[var(--muted)] sm:text-[11px]">{label}</p>
      <div className="mt-1 flex items-baseline gap-2 sm:mt-2">
        <span className="text-3xl font-light tabular-nums sm:text-4xl" style={{ color: accent }}>
          {value === null ? "–" : <CountUp value={value} decimals={decimals} />}
          {value !== null && suffix && <span className="ml-0.5 text-xl text-[var(--muted)]">{suffix}</span>}
        </span>
        {badge && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: badge.good ? "var(--teal)" : "var(--coral)",
              background: `color-mix(in srgb, ${badge.good ? "var(--teal)" : "var(--coral)"} 14%, transparent)`,
            }}
          >
            {badge.text}
          </span>
        )}
      </div>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
    </motion.div>
  );
}

// Backlog / In progress / Done as one proportional bar
export function StageBar({ backlog, inProgress, done }: { backlog: number; inProgress: number; done: number }) {
  const total = backlog + inProgress + done || 1;
  const parts = [
    { label: "Backlog", value: backlog, color: "var(--violet)" },
    { label: "In progress", value: inProgress, color: "var(--amber)" },
    { label: "Done", value: done, color: "var(--teal)" },
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts.map((p, i) => (
          <motion.div
            key={p.label}
            style={{ background: p.color }}
            initial={{ width: 0 }}
            animate={{ width: `${(p.value / total) * 100}%` }}
            transition={{ duration: 0.9, delay: i * 0.1, ease: "easeOut" }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-center">
        {parts.map((p) => (
          <li key={p.label}>
            <div className="text-2xl font-light tabular-nums" style={{ color: p.color }}>
              <CountUp value={p.value} />
            </div>
            <div className="text-[11px] text-[var(--muted)]">{p.label}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Vertical bars that grow from zero
export function ColumnChart({
  data,
  color = "var(--teal)",
  color2,
  height = 120,
}: {
  data: { label: string; value: number; value2?: number }[];
  color?: string;
  color2?: string;
  height?: number;
}) {
  const max = Math.max(...data.flatMap((d) => [d.value, d.value2 ?? 0]), 1);
  return (
    <div className="flex items-end gap-2" style={{ height: height + 22 }}>
      {data.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${d.value}${d.value2 !== undefined ? ` done, ${d.value2} created` : ""}`}>
          <div className="flex w-full shrink-0 items-end justify-center gap-[3px]" style={{ height }}>
            {d.value2 !== undefined && color2 && (
              <motion.div
                className="w-1/2 max-w-3 rounded-t"
                style={{ background: color2, opacity: 0.55 }}
                initial={{ height: 0 }}
                animate={{ height: Math.round((d.value2 / max) * height) }}
                transition={{ duration: 0.7, delay: i * 0.05, ease: "easeOut" }}
              />
            )}
            <motion.div
              className="w-1/2 max-w-4 rounded-t"
              style={{ background: color, minHeight: d.value ? 3 : 0 }}
              initial={{ height: 0 }}
              animate={{ height: Math.round((d.value / max) * height) }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: "easeOut" }}
            />
          </div>
          <span className="w-full truncate text-center text-[10px] text-[var(--muted)]">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// 12 weeks x 7 days, like a contribution calendar
export function Heatmap({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(...days.map((d) => d.count), 1);
  const offset = new Date(days[0].date + "T00:00:00Z").getUTCDay(); // so rows line up with weekdays
  const shade = (n: number) => (n === 0 ? "rgb(var(--tint)/0.07)" : `color-mix(in srgb, var(--teal) ${25 + Math.round((n / max) * 75)}%, transparent)`);
  return (
    <div>
      <div className="grid grid-flow-col grid-rows-7 gap-1" role="img" aria-label="Tasks completed per day over the last 12 weeks">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`o${i}`} className="aspect-square" />
        ))}
        {days.map((d, i) => (
          <motion.span
            key={d.date}
            title={`${d.date}: ${d.count} completed`}
            className="aspect-square rounded-[3px]"
            style={{ background: shade(d.count) }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: Math.min(i * 0.006, 0.5) }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-[var(--muted)]">
        Less
        {[0, 1, 2, 3].map((n) => (
          <span key={n} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: shade((n / 3) * max) }} />
        ))}
        More
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[rgb(var(--tint)/0.07)] ${className}`} />;
}
