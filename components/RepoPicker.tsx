"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VISIBLE = 60; // rows drawn at once; searching narrows the rest

type Repo = { name: string; private: boolean };
type Loaded = { all: Repo[]; recent: string[]; connected: boolean; error?: string };

type Props = { selected: string[]; onChange: (repos: string[]) => void };

// Searchable list of every repository the connected GitHub token can see, with the ones holding your recent PRs first.
export function RepoPicker({ selected, onChange }: Props) {
  const [data, setData] = useState<Loaded | null>(null);
  const [query, setQuery] = useState("");
  const [switching, setSwitching] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/sync/repos")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ all: [], recent: [], connected: true, error: "Could not load your repositories." }));
  }, []);

  useEffect(() => {
    load();
    search.current?.focus();
  }, [load]);

  // Reuses the GitHub CLI login of this computer, which usually sees every organisation repo you belong to
  async function useCli() {
    setSwitching(true);
    setNote(null);
    try {
      const res = await fetch("/api/connections/github/gh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not switch.");
      setNote({ text: body.next, error: false });
      setData(null);
      load();
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    } finally {
      setSwitching(false);
    }
  }

  // Recent PR repos first, then the rest by last push (the order GitHub returns them in)
  const rows = useMemo(() => {
    if (!data) return [];
    const recent = new Set(data.recent);
    const byName = new Map(data.all.map((r) => [r.name, r]));
    const ordered = [...data.recent.map((n) => byName.get(n) ?? { name: n, private: false }), ...data.all.filter((r) => !recent.has(r.name))];
    const q = query.trim().toLowerCase();
    return (q ? ordered.filter((r) => r.name.toLowerCase().includes(q)) : ordered).map((r) => ({ ...r, recent: recent.has(r.name) }));
  }, [data, query]);

  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((r) => r !== name) : [...selected, name]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={data ? `Search ${data.all.length} repositories` : "Loading your repositories…"}
        aria-label="Search repositories"
        className="rounded-full border border-[var(--glass-border)] bg-transparent px-4 py-2 text-xs outline-none focus:border-[var(--violet)]"
      />

      <ul className="mt-3 min-h-24 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Repositories" aria-busy={!data}>
        {rows.slice(0, VISIBLE).map((r) => (
          <li key={r.name}>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-xs hover:bg-[rgb(var(--tint)/0.08)]">
              <input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)} className="accent-[var(--violet)]" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {r.recent && <span className="shrink-0 text-[10px] text-[var(--teal)]">your PRs</span>}
              {r.private && <span className="shrink-0 text-[10px] text-[var(--muted)]">private</span>}
            </label>
          </li>
        ))}
        {data && rows.length > VISIBLE && (
          <li className="px-3 py-1 text-[11px] text-[var(--muted)]">
            Showing {VISIBLE} of {rows.length}. Type to narrow the list.
          </li>
        )}
        {data && !rows.length && (
          <li className="px-3 py-3 text-xs text-[var(--muted)]">
            {query ? "No repository matches." : data.connected ? data.error ?? "No repositories are visible to this token." : "GitHub is not connected. Connect it on the Configs tab first."}
          </li>
        )}
      </ul>

      {data && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
          <span>Missing your organisation repos?</span>
          <button className="chip" onClick={useCli} disabled={switching}>
            {switching ? "Switching…" : "Use my GitHub CLI login"}
          </button>
        </div>
      )}
      {note && (
        <p role={note.error ? "alert" : "status"} className="mt-1 text-[11px]" style={{ color: note.error ? "var(--coral)" : "var(--teal)" }}>
          {note.text}
        </p>
      )}
    </div>
  );
}
