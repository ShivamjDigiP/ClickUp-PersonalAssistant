"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";

// Small shared pieces for the CXO screens, so every page looks and reads the same.

export type Note = { key: string; text: string; tone: "info" | "attention" };
// Plain facts about what is going on with a person. Amber marks something worth a conversation, never a grade.
export function Notes({ notes, limit }: { notes: Note[]; limit?: number }) {
  const list = limit ? notes.slice(0, limit) : notes;
  if (list.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {list.map((n) => (
        <li key={n.key} className="flex gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: n.tone === "attention" ? "var(--amber)" : "var(--muted)" }} aria-hidden />
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

export const LAYER_COLOR: Record<string, string> = { frontend: "var(--violet)", backend: "var(--teal)", mobile: "var(--amber)", infra: "#6fb7ff", other: "var(--muted)" };
export const colorForKey = (key: string, i = 0) => LAYER_COLOR[key] ?? ["var(--violet)", "var(--teal)", "var(--amber)", "var(--coral)", "#6fb7ff", "#c58bff"][i % 6];

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString());
export const pctText = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${Math.round(r * 100)}%`);
export const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-slate-900" style={{ width: size, height: size, fontSize: size * 0.38, background: "linear-gradient(135deg,#7df0d0,#a99bff)" }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Sparkline({ values, color = "var(--teal)", width = 84, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === 0)) return <span className="text-[10px] text-[var(--muted)]">no data</span>;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Weekly trend: ${values.join(", ")}`}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="2.2" fill={color} />
    </svg>
  );
}

// One horizontal bar split into labelled segments (e.g. frontend / backend / mobile).
export function SplitBar({ parts, height = 10, legend = true }: { parts: { key: string; value: number; label?: string }[]; height?: number; legend?: boolean }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return <p className="text-xs text-[var(--muted)]">No activity in this period.</p>;
  return (
    <div>
      <div className="flex overflow-hidden rounded-full bg-[rgb(var(--tint)/0.08)]" style={{ height }} role="img" aria-label={parts.map((p) => `${p.key} ${p.value}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <motion.div key={p.key} title={`${p.key}: ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`} style={{ background: colorForKey(p.key, i) }} initial={{ width: 0 }} animate={{ width: `${(p.value / total) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.08, ease: "easeOut" }} />
        ))}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
          {parts.filter((p) => p.value > 0).map((p, i) => (
            <li key={p.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: colorForKey(p.key, i) }} />
              {p.label ?? p.key} <b className="font-medium text-[var(--fg)]">{fmt(p.value)}</b> <span>({Math.round((p.value / total) * 100)}%)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="z-30 -mx-4 mb-5 flex flex-col gap-2 border-b border-[var(--glass-border)] bg-[color-mix(in_srgb,var(--bg)_90%,var(--violet))] px-4 pb-2.5 shadow-[0_8px_24px_-18px_rgb(0_0_0/0.6)] backdrop-blur-xl sm:-mx-8 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8 md:sticky md:top-0 md:-mt-8 md:pt-3">
      <div className="min-w-0 sm:flex-1">
        <h1 className="truncate text-lg font-normal leading-tight tracking-tight sm:text-xl">{title}</h1>
        {sub && <p className="mt-0.5 max-w-3xl truncate text-xs text-[var(--muted)]" title={typeof sub === "string" ? sub : undefined}>{sub}</p>}
      </div>
      {right && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{right}</div>}
    </header>
  );
}

export function Section({ title, hint, children, className = "", right }: { title: string; hint?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`glass p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-widest text-[var(--muted)]">{title}</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          {hint}
          {right}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Periods<T extends number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex max-w-full gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]" role="group" aria-label="Duration">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value} className="chip">
          {o.label}
        </button>
      ))}
    </div>
  );
}
// The platform offers two durations everywhere: the last 30 days, or everything on record.
export const PERIODS = [{ value: 30, label: "Last 30 days" }, { value: 0, label: "All" }];
export const WIDE_PERIODS = PERIODS;

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-[var(--coral)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)] px-4 py-3 text-sm">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-3 underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="glass grid place-items-center px-6 py-12 text-center">
      <div className="max-w-md">
        <div className="orb mx-auto h-14 w-14" aria-hidden />
        <h3 className="mt-5 text-lg font-light">{title}</h3>
        {children && <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{children}</p>}
        {action && (
          <Link href={action.href} className="mt-5 inline-block rounded-full px-5 py-2.5 text-sm font-semibold text-slate-900" style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}>
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

export const Btn = {
  primary: "rounded-full px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50",
  primaryStyle: { background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" } as const,
  ghost: "chip disabled:opacity-50",
  danger: "rounded-full border border-[var(--coral)] px-3 py-1.5 text-xs text-[var(--coral)] hover:bg-[color-mix(in_srgb,var(--coral)_12%,transparent)] disabled:opacity-50",
};

export const inputCls = "w-full rounded-xl border border-[var(--glass-border)] bg-[rgb(var(--tint)/0.05)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--violet)]";

export const TableSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <div className="space-y-2">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="h-12 animate-pulse rounded-xl bg-[rgb(var(--tint)/0.07)]" />
    ))}
  </div>
);
