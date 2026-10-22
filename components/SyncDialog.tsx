"use client";

import { useEffect, useState } from "react";
import { RepoPicker } from "./RepoPicker";

const DAY_OPTIONS = [7, 14, 30, 60] as const;
const PREFS_KEY = "clickup-assistant:sync-prefs";

type Prefs = { repos: string[]; days: number; ai: boolean };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (p && Array.isArray(p.repos)) return { repos: p.repos.filter((r: unknown) => typeof r === "string"), days: DAY_OPTIONS.includes(p.days) ? p.days : 14, ai: p.ai !== false };
  } catch {}
  return { repos: [], days: 14, ai: true };
}

type Props = { onClose: () => void; onRun: (repos: string[], days: number, ai: boolean) => void };

// Pick which repositories to compare with ClickUp from everything the connected token can see. Nothing to type.
export function SyncDialog({ onClose, onRun }: Props) {
  const [prefs] = useState(loadPrefs);
  const [selected, setSelected] = useState<string[]>(prefs.repos);
  const [days, setDays] = useState<number>(prefs.days);
  const [ai, setAi] = useState(prefs.ai);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ repos: selected, days, ai }));
    } catch {}
    onRun(selected, days, ai);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
        className="glass flex max-h-[90vh] w-full max-w-md flex-col rounded-3xl p-5"
        style={{ background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="sync-title" className="text-xl font-light">
          Sync ClickUp ↔ GitHub
        </h3>
        <p className="mb-4 mt-1 text-xs text-[var(--muted)]">Which repositories should I compare with your ClickUp tasks?</p>

        <RepoPicker selected={selected} onChange={setSelected} />

        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Time range">
          <span className="text-xs text-[var(--muted)]">Look back</span>
          {DAY_OPTIONS.map((d) => (
            <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-3 text-xs">
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-0.5 accent-[var(--violet)]" />
          <span>
            Use AI to match PRs by meaning
            <span className="block text-[11px] text-[var(--muted)]">Reads each unmatched PR&apos;s CHANGELOG entry and finds the ClickUp task it belongs to. Takes a few extra seconds.</span>
          </span>
        </label>
        <p className="mt-2 text-[11px] text-[var(--muted)]">{selected.length ? `${selected.length} selected.` : "Nothing selected: I will check your PRs in every repository."}</p>

        <div className="mt-3 flex justify-end gap-2">
          {!!selected.length && (
            <button className="chip" onClick={() => setSelected([])}>
              Clear
            </button>
          )}
          <button className="chip" onClick={onClose}>
            Cancel
          </button>
          <button className="chip" style={{ background: "rgb(var(--tint) / 0.18)" }} onClick={run}>
            Run sync
          </button>
        </div>
      </div>
    </div>
  );
}
