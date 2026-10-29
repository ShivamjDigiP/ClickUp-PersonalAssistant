"use client";

import { useMemo, useState } from "react";
import { inputCls } from "./ui";

export type RepoInfo = { name: string; private: boolean; archived: boolean; fork: boolean; pushedAt: number | null };

const ACTIVE_MS = 90 * 86_400_000;
const ago = (ms: number | null) => {
  if (!ms) return "no activity";
  const d = Math.round((Date.now() - ms) / 86_400_000);
  return d < 1 ? "today" : d < 31 ? `${d} d ago` : d < 365 ? `${Math.round(d / 30)} mo ago` : `${Math.round(d / 365)} y ago`;
};

// A searchable checklist of the repositories a token can read. The parent owns the selection.
export function RepoPicker({ repos, selected, onChange }: { repos: RepoInfo[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState("");
  const chosen = useMemo(() => new Set(selected), [selected]);
  const shown = useMemo(() => repos.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())), [repos, q]);
  const activeNames = () => repos.filter((r) => !r.archived && !r.fork && (r.pushedAt ?? 0) >= Date.now() - ACTIVE_MS).map((r) => r.name);
  const toggle = (name: string) => onChange(chosen.has(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} !w-56`} placeholder="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search repositories" />
        <button type="button" className="chip" onClick={() => onChange(activeNames())} title="Everything pushed to in the last 90 days, except archived repositories and forks">Active only</button>
        <button type="button" className="chip" onClick={() => onChange([...new Set([...selected, ...shown.map((r) => r.name)])])}>Select shown</button>
        <button type="button" className="chip" onClick={() => onChange([])}>Clear</button>
        <span className="text-xs text-[var(--muted)]">{selected.length} of {repos.length} chosen</span>
      </div>
      <ul className="max-h-72 divide-y divide-[var(--glass-border)] overflow-y-auto rounded-xl border border-[var(--glass-border)]">
        {shown.map((r) => (
          <li key={r.name}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[rgb(var(--tint)/0.05)]">
              <input type="checkbox" checked={chosen.has(r.name)} onChange={() => toggle(r.name)} className="accent-[var(--violet)]" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {r.private && <span className="text-[11px] text-[var(--muted)]">private</span>}
              {r.archived && <span className="text-[11px] text-[var(--amber)]">archived</span>}
              {r.fork && <span className="text-[11px] text-[var(--muted)]">fork</span>}
              <span className="w-20 shrink-0 text-right text-[11px] text-[var(--muted)]">{ago(r.pushedAt)}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-4 text-sm text-[var(--muted)]">No repository matches.</li>}
      </ul>
    </div>
  );
}
