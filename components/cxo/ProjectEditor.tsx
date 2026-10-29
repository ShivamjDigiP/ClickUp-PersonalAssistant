"use client";

import { useMemo, useState } from "react";
import { api } from "./api";
import { Btn, ErrorBox, inputCls, LAYER_COLOR } from "./ui";

export const LAYER_LIST = ["frontend", "backend", "mobile", "infra", "other"] as const;
export type KnownRepo = { repo: string; commits: number; prs: number; projects: string[]; suggestedLayer: string | null; suggestedPart: string | null };
export type KnownList = { name: string; source: string; tasks: number; projects: string[] };
export type EditorValue = { id?: string; name: string; description?: string | null; repos: { repo: string; layer: string; part: string | null }[]; taskLists: string[] };

// Create or edit a project: choose its repositories (and tag each as frontend / backend / ... and an optional part such
// as admin or user) and the task lists that belong to it.
export function ProjectEditor({ initial, repos, lists, onSaved, onCancel }: { initial: EditorValue; repos: KnownRepo[]; lists: KnownList[]; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [picked, setPicked] = useState<Record<string, { layer: string; part: string }>>(() => Object.fromEntries(initial.repos.map((r) => [r.repo, { layer: r.layer, part: r.part ?? "" }])));
  const [pickedLists, setPickedLists] = useState<Set<string>>(new Set(initial.taskLists));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // repos from the data, plus any already in this project that no longer show up there
  const allRepos = useMemo(() => {
    const known = new Map(repos.map((r) => [r.repo.toLowerCase(), r]));
    const extra = initial.repos.filter((r) => !known.has(r.repo.toLowerCase())).map((r) => ({ repo: r.repo, commits: 0, prs: 0, projects: [], suggestedLayer: null, suggestedPart: null }) as KnownRepo);
    return [...repos, ...extra];
  }, [repos, initial.repos]);
  const shown = allRepos.filter((r) => r.repo.toLowerCase().includes(filter.toLowerCase()));

  function toggle(r: KnownRepo) {
    setPicked((p) => {
      const n = { ...p };
      if (n[r.repo]) delete n[r.repo];
      else n[r.repo] = { layer: r.suggestedLayer ?? "other", part: r.suggestedPart ?? "" };
      return n;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name,
      description: description || null,
      repos: Object.entries(picked).map(([repo, v]) => ({ repo, layer: v.layer, part: v.part.trim() || null })),
      taskLists: [...pickedLists],
    };
    try {
      await api(initial.id ? `/api/cxo/projects/${initial.id}` : "/api/cxo/projects", { method: initial.id ? "PUT" : "POST", body });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial.id || !window.confirm(`Delete the project "${initial.name}"? Repositories and tasks are not deleted, only the grouping.`)) return;
    setBusy(true);
    await api(`/api/cxo/projects/${initial.id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
    onSaved();
  }

  return (
    <div className="glass mb-6 p-4 sm:p-5">
      <h2 className="mb-4 text-lg font-light">{initial.id ? "Edit project" : "New project"}</h2>
      {error && <ErrorBox message={error} />}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input className={inputCls} placeholder="Project name (e.g. Shop)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[11px] uppercase tracking-widest text-[var(--muted)]">Repositories ({Object.keys(picked).length} chosen)</h3>
            <input className={`${inputCls} !w-44`} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {allRepos.length === 0 && <p className="text-sm text-[var(--muted)]">No repositories yet. Connect GitHub under Integrations and sync first.</p>}
          <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {shown.map((r) => {
              const on = picked[r.repo];
              const elsewhere = r.projects.filter((p) => p !== initial.name);
              return (
                <li key={r.repo} className={`rounded-xl px-3 py-2 ${on ? "bg-[rgb(var(--tint)/0.1)]" : "bg-[rgb(var(--tint)/0.04)]"}`}>
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" checked={!!on} onChange={() => toggle(r)} className="h-4 w-4 accent-[var(--violet)]" />
                    <span className="min-w-0 flex-1 truncate">{r.repo}</span>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{r.commits} commits</span>
                  </label>
                  {elsewhere.length > 0 && <p className="ml-7 mt-0.5 text-[11px] text-[var(--amber)]">also in {elsewhere.join(", ")}</p>}
                  {on && (
                    <div className="ml-7 mt-2 flex flex-wrap items-center gap-2">
                      <select aria-label={`Layer of ${r.repo}`} value={on.layer} onChange={(e) => setPicked((p) => ({ ...p, [r.repo]: { ...on, layer: e.target.value } }))} className={`${inputCls} !w-36 capitalize`} style={{ borderColor: LAYER_COLOR[on.layer] }}>
                        {LAYER_LIST.map((l) => (
                          <option key={l} value={l} className="bg-slate-900">{l}</option>
                        ))}
                      </select>
                      <input aria-label={`Part of ${r.repo}`} className={`${inputCls} !w-44`} placeholder="Part: admin, user… (optional)" value={on.part} onChange={(e) => setPicked((p) => ({ ...p, [r.repo]: { ...on, part: e.target.value } }))} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="lg:col-span-2">
          <h3 className="mb-2 text-[11px] uppercase tracking-widest text-[var(--muted)]">Task lists ({pickedLists.size} chosen)</h3>
          {lists.length === 0 && <p className="text-sm text-[var(--muted)]">No task lists yet. Connect ClickUp or Jira first.</p>}
          <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {lists.map((l) => {
              const elsewhere = l.projects.filter((p) => p !== initial.name);
              return (
                <li key={`${l.source}:${l.name}`} className="rounded-xl bg-[rgb(var(--tint)/0.04)] px-3 py-2">
                  <label className="flex cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" checked={pickedLists.has(l.name)} onChange={() => setPickedLists((s) => { const n = new Set(s); if (n.has(l.name)) n.delete(l.name); else n.add(l.name); return n; })} className="h-4 w-4 accent-[var(--violet)]" />
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{l.tasks} tasks · {l.source}</span>
                  </label>
                  {elsewhere.length > 0 && <p className="ml-7 mt-0.5 text-[11px] text-[var(--amber)]">also in {elsewhere.join(", ")}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy || !name.trim()} className={Btn.primary} style={Btn.primaryStyle}>{busy ? "Saving…" : "Save project"}</button>
        <button onClick={onCancel} disabled={busy} className={Btn.ghost}>Cancel</button>
        {initial.id && <button onClick={remove} disabled={busy} className={`${Btn.danger} ml-auto`}>Delete project</button>}
      </div>
    </div>
  );
}
