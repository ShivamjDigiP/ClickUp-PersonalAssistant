"use client";

import { useState } from "react";
import { api, useApi } from "./api";
import { Btn, ErrorBox, inputCls, PageHeader, Section, TableSkeleton } from "./ui";
import { RepoPicker, type RepoInfo } from "./RepoPicker";

type Integration = { id: string; provider: "clickup" | "github" | "jira"; label: string; config: Record<string, unknown>; status: string; lastSyncAt: number | null; lastError: string | null };
type AuditCheck = { label: string; live: number | string; stored: number | string; status: "match" | "explained" | "mismatch"; note?: string };
type AuditStep = { label: string; value: number; note?: string; kind?: "total" | "minus" | "result" };
type AuditSource = { integrationId: string; provider: string; label: string; lastSyncAt: number | null; checks: AuditCheck[]; waterfall: AuditStep[]; examples: string[]; error?: string };
type AuditReport = { generatedAt: number; sources: AuditSource[] };
type SyncOutcome = { ok: true; counts: Record<string, number>; notes: string[] } | { ok: false; error: string };

const ago = (ms: number | null) => {
  if (!ms) return "never";
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const PROVIDERS = {
  clickup: {
    name: "ClickUp",
    gives: "Tasks: who is assigned what, what was finished, when, and how late.",
    help: "In ClickUp: click your avatar, Settings, Apps, then API Token. The token only needs to be able to read the workspace.",
    unverified: false,
  },
  github: {
    name: "GitHub",
    gives: "Commits and pull requests per repository and per person: what each change was, how far it reached, and how smoothly it was reviewed.",
    help: "Create a token at github.com/settings/tokens. Classic: tick repo and read:org. Fine-grained: choose the organization and give Read access to Contents, Pull requests and Metadata.",
    unverified: false,
  },
  jira: {
    name: "Jira",
    gives: "Issues with real start, finish and reopen history from Jira's change log.",
    help: "Create an API token at id.atlassian.com/manage-profile/security/api-tokens. Use the e-mail of the account that owns it. Only *.atlassian.net sites are supported.",
    unverified: true,
  },
} as const;
type ProviderKey = keyof typeof PROVIDERS;

function ConnectForm({ provider, onDone, onCancel }: { provider: ProviderKey; onDone: (id: string) => void; onCancel: () => void }) {
  const [v, setV] = useState({ secret: "", teamId: "", org: "", repos: "", maxRepos: "25", site: "", email: "", projects: "" });
  const [excludeMerges, setExcludeMerges] = useState(true); // recommended, and the default everywhere
  const [found, setFound] = useState<RepoInfo[] | null>(null); // GitHub: the repositories the token can read
  const [picked, setPicked] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const list = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

  async function findRepos() {
    setFinding(true);
    setError(null);
    try {
      const out = await api<{ repos: RepoInfo[]; selected: string[] }>("/api/cxo/github/repos", { method: "POST", body: { secret: v.secret, ...(v.org.trim() ? { org: v.org.trim() } : {}) } });
      setFound(out.repos);
      setPicked(out.selected);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFinding(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (provider === "github" && !found) return void findRepos(); // GitHub is two steps: find the repositories, then choose
    if (provider === "github" && picked.length === 0) return setError("Choose at least one repository.");
    setBusy(true);
    setError(null);
    const config =
      provider === "clickup" ? (v.teamId.trim() ? { teamId: v.teamId.trim() } : {})
      : provider === "github" ? { ...(v.org.trim() ? { org: v.org.trim() } : {}), repos: picked, excludeMergeCommits: excludeMerges }
      : { site: v.site, email: v.email, ...(list(v.projects).length ? { projects: list(v.projects) } : {}) };
    try {
      const out = await api<{ id: string }>("/api/cxo/integrations", { method: "POST", body: { provider, secret: v.secret, config } });
      setV((s) => ({ ...s, secret: "" })); // the token is not kept in the page once it has been sent
      onDone(out.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl bg-[rgb(var(--tint)/0.04)] p-4">
      <p className="text-xs leading-relaxed text-[var(--muted)]">{PROVIDERS[provider].help}</p>
      {error && <ErrorBox message={error} />}
      {provider === "jira" && (
        <>
          <input className={inputCls} placeholder="Jira site, e.g. yourcompany.atlassian.net" required value={v.site} onChange={set("site")} />
          <input className={inputCls} type="email" placeholder="Atlassian account e-mail" required value={v.email} onChange={set("email")} />
        </>
      )}
      <input className={inputCls} type="password" autoComplete="off" placeholder={`${PROVIDERS[provider].name} API token`} required value={v.secret} onChange={set("secret")} />
      {provider === "github" && (
        <>
          <input className={inputCls} placeholder="Organization (optional, e.g. DigiProdigy). Empty = your own repositories" value={v.org} onChange={(e) => { set("org")(e); setFound(null); }} />
          {found && (
            <div>
              <p className="mb-2 text-xs text-[var(--muted)]">Choose the repositories to include. Only these are read, so nothing else comes in. You can change this later.</p>
              <RepoPicker repos={found} selected={picked} onChange={setPicked} />
            </div>
          )}
          <label className="flex items-start gap-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={excludeMerges} onChange={(e) => setExcludeMerges(e.target.checked)} className="mt-0.5 accent-[var(--violet)]" />
            <span><b className="font-medium text-[var(--fg)]">Do not count merge commits</b> (recommended). They only join branches together and are not work someone wrote, so they are left out of every number and list.</span>
          </label>
        </>
      )}
      {provider === "clickup" && <input className={inputCls} placeholder="Workspace ID (optional: the first workspace is used)" value={v.teamId} onChange={set("teamId")} />}
      {provider === "jira" && <input className={inputCls} placeholder="Only these project keys (optional), e.g. ABC, PAY" value={v.projects} onChange={set("projects")} />}
      <div className="flex items-center gap-2">
        <button disabled={busy} className={Btn.primary} style={Btn.primaryStyle}>
          {busy ? "Checking the token…" : finding ? "Finding repositories…" : provider === "github" && !found ? "Find repositories" : "Connect and sync"}
        </button>
        <button type="button" onClick={onCancel} className={Btn.ghost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function IntegrationsScreen() {
  const { data, error, loading, reload } = useApi<{ integrations: Integration[] }>("/api/cxo/integrations");
  const [adding, setAdding] = useState<ProviderKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SyncOutcome>>({});
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  async function runAudit() {
    setAuditing(true);
    setAuditError(null);
    try {
      setAudit(await api<AuditReport>("/api/cxo/audit", { method: "POST", body: {} }));
    } catch (e) {
      setAuditError((e as Error).message);
    } finally {
      setAuditing(false);
    }
  }

  async function sync(id: string, full = false) {
    setBusyId(id);
    try {
      const out = await api<SyncOutcome>(`/api/cxo/integrations/${id}/sync${full ? "?full=1" : ""}`, { method: "POST", body: {} });
      setOutcomes((o) => ({ ...o, [id]: out }));
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setBusyId(null);
      void reload();
    }
  }

  async function setMerges(i: Integration, exclude: boolean) {
    setBusyId(i.id);
    try {
      await api(`/api/cxo/integrations/${i.id}`, { method: "PATCH", body: { excludeMergeCommits: exclude } });
    } catch (e) {
      setOutcomes((o) => ({ ...o, [i.id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setBusyId(null);
      void reload();
    }
  }

  const [editing, setEditing] = useState<{ id: string; repos: RepoInfo[]; picked: string[]; loading: boolean; error: string | null } | null>(null);

  async function editRepos(i: Integration) {
    setEditing({ id: i.id, repos: [], picked: [], loading: true, error: null });
    try {
      const out = await api<{ repos: RepoInfo[]; selected: string[] }>("/api/cxo/github/repos", { method: "POST", body: { integrationId: i.id } });
      setEditing({ id: i.id, repos: out.repos, picked: out.selected, loading: false, error: null });
    } catch (e) {
      setEditing({ id: i.id, repos: [], picked: [], loading: false, error: (e as Error).message });
    }
  }

  async function saveRepos() {
    if (!editing || editing.picked.length === 0) return;
    const { id, picked } = editing;
    setBusyId(id);
    try {
      await api(`/api/cxo/integrations/${id}`, { method: "PATCH", body: { repos: picked } });
      setEditing(null);
      await sync(id, true); // a full read drops the repositories that are no longer chosen
    } catch (e) {
      setEditing((x) => (x ? { ...x, error: (e as Error).message } : x));
      setBusyId(null);
    }
  }

  async function remove(i: Integration) {
    if (!window.confirm(`Disconnect ${i.label}? Data already synced stays, but it will stop updating.`)) return;
    await api(`/api/cxo/integrations/${i.id}`, { method: "DELETE" }).catch(() => {});
    void reload();
  }

  const items = data?.integrations ?? [];
  const describe = (i: Integration) => {
    const c = i.config as { org?: string; repos?: string[]; site?: string; projects?: string[] };
    return [c.org && `org ${c.org}`, c.repos?.length && `${c.repos.length} repos`, c.site, c.projects?.length && `projects ${c.projects.join(", ")}`].filter(Boolean).join(" · ");
  };

  return (
    <>
      <PageHeader title="Integrations" sub="Connect your tools once. They stay connected for this workspace, even after you sign out." />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <TableSkeleton rows={3} />}

      {items.length > 0 && (
        <Section title="Data check" hint="is this data right?" className="mb-5" right={<button onClick={runAudit} disabled={auditing} className={Btn.ghost}>{auditing ? "Checking…" : audit ? "Check again" : "Check my data"}</button>}>
          <p className="text-sm text-[var(--muted)]">Re-counts everything directly from ClickUp and GitHub by a different route than the sync uses, then shows how those totals become the numbers on your dashboards. Differences are explained, never hidden. It can take a minute.</p>
          {auditError && <div className="mt-3"><ErrorBox message={auditError} /></div>}
          {audit && (
            <div className="mt-4 space-y-5">
              <p className="text-[11px] text-[var(--muted)]">Checked {new Date(audit.generatedAt).toLocaleString()}</p>
              {audit.sources.map((src) => (
                <div key={src.integrationId} className="rounded-2xl bg-[rgb(var(--tint)/0.04)] p-4">
                  <p className="text-sm font-medium">{src.label}</p>
                  {src.error && <div className="mt-2"><ErrorBox message={src.error} /></div>}
                  {src.waterfall.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {src.waterfall.map((w, i) => (
                        <li key={i} className={`flex items-baseline justify-between gap-4 ${w.kind === "result" ? "border-t border-[var(--glass-border)] pt-1.5 font-medium" : ""}`}>
                          <span className={w.kind === "minus" ? "text-[var(--muted)]" : ""}>{w.kind === "minus" ? "− " : w.kind === "result" ? "= " : ""}{w.label}{w.note && <span className="block text-[11px] text-[var(--muted)]">{w.note}</span>}</span>
                          <span className="shrink-0 tabular-nums">{w.value.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {src.checks.length > 0 && (
                    <ul className="mt-4 space-y-2 border-t border-[var(--glass-border)] pt-3 text-xs">
                      {src.checks.map((c, i) => (
                        <li key={i} className="flex gap-3">
                          <span aria-label={c.status} className="mt-0.5 w-4 shrink-0 text-center" style={{ color: c.status === "match" ? "var(--teal)" : c.status === "explained" ? "var(--amber)" : "var(--coral)" }}>{c.status === "match" ? "✓" : c.status === "explained" ? "i" : "✗"}</span>
                          <span className="min-w-0 flex-1">
                            {c.label}
                            <span className="block text-[var(--muted)]">{c.live} at the source · {c.stored} stored{c.note ? ` · ${c.note}` : ""}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {src.examples.map((e, i) => <p key={i} className="mt-2 text-xs text-[var(--amber)]">{e}</p>)}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <div className="space-y-5">
        {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => {
          const p = PROVIDERS[key];
          const mine = items.filter((i) => i.provider === key);
          return (
            <Section key={key} title={p.name} hint={mine.length ? `${mine.length} connected` : "not connected"} right={!adding && <button onClick={() => setAdding(key)} className={Btn.ghost}>{mine.length ? "Connect another" : "Connect"}</button>}>
              <p className="text-sm text-[var(--muted)]">{p.gives}</p>
              {p.unverified && <p className="mt-2 rounded-xl bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] px-3 py-2 text-xs">The Jira connection is built to Atlassian&apos;s documentation but has not been run against a live Jira yet. After connecting, compare the numbers with Jira and tell us what looks off.</p>}

              {mine.map((i) => {
                const out = outcomes[i.id];
                return (
                  <div key={i.id} className="mt-4 rounded-2xl bg-[rgb(var(--tint)/0.04)] p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.status === "ok" ? "var(--teal)" : i.status === "error" ? "var(--coral)" : "var(--amber)" }} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{i.label}</p>
                        <p className="truncate text-xs text-[var(--muted)]">
                          {describe(i) || "default settings"} · last synced {ago(i.lastSyncAt)}
                        </p>
                      </div>
                      <button disabled={busyId === i.id} onClick={() => sync(i.id)} className={Btn.ghost}>{busyId === i.id ? "Syncing…" : "Sync now"}</button>
                      <button disabled={busyId === i.id} onClick={() => sync(i.id, true)} className={Btn.ghost} title="Re-read the whole history instead of only what changed">Full re-sync</button>
                      {i.provider === "github" && <button disabled={busyId === i.id} onClick={() => editRepos(i)} className={Btn.ghost}>Choose repositories</button>}
                      <button onClick={() => remove(i)} className={Btn.danger}>Disconnect</button>
                    </div>
                    {editing?.id === i.id && (
                      <div className="mt-4 space-y-3 border-t border-[var(--glass-border)] pt-4">
                        {editing.loading && <p className="text-xs text-[var(--muted)]">Loading repositories…</p>}
                        {editing.error && <ErrorBox message={editing.error} />}
                        {!editing.loading && editing.repos.length > 0 && (
                          <>
                            <RepoPicker repos={editing.repos} selected={editing.picked} onChange={(next) => setEditing((x) => (x ? { ...x, picked: next } : x))} />
                            <p className="text-xs text-[var(--muted)]">Saving re-reads the whole history of the chosen repositories and removes the data of the ones you unticked.</p>
                          </>
                        )}
                        <div className="flex items-center gap-2">
                          <button disabled={busyId === i.id || editing.loading || editing.picked.length === 0} onClick={saveRepos} className={Btn.primary} style={Btn.primaryStyle}>Save and re-sync</button>
                          <button onClick={() => setEditing(null)} className={Btn.ghost}>Cancel</button>
                        </div>
                      </div>
                    )}
                    {i.provider === "github" && (
                      <label className="mt-3 flex items-start gap-2 text-xs text-[var(--muted)]">
                        <input type="checkbox" disabled={busyId === i.id} checked={i.config.excludeMergeCommits !== false} onChange={(e) => setMerges(i, e.target.checked)} className="mt-0.5 accent-[var(--violet)]" />
                        <span><b className="font-medium text-[var(--fg)]">Do not count merge commits</b>. Untick to include them everywhere; it applies at once, no re-sync needed.</span>
                      </label>
                    )}
                    {i.status === "error" && i.lastError && <ErrorBox message={i.lastError} />}
                    {out && out.ok && (
                      <p className="mt-3 text-xs text-[var(--muted)]">
                        Synced: {Object.entries(out.counts).map(([k, n]) => `${n} ${k}`).join(", ")}.
                        {out.notes.map((n, k) => <span key={k} className="mt-1 block text-[var(--amber)]">{n}</span>)}
                      </p>
                    )}
                    {out && !out.ok && <div className="mt-3"><ErrorBox message={out.error} /></div>}
                  </div>
                );
              })}

              {adding === key && (
                <ConnectForm
                  provider={key}
                  onCancel={() => setAdding(null)}
                  onDone={(id) => {
                    setAdding(null);
                    void reload().then(() => sync(id, true)); // first sync reads the history
                  }}
                />
              )}
            </Section>
          );
        })}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">
        Tokens are encrypted on the server and never shown again. After the first sync, open <b>People</b> to confirm which GitHub account belongs to which developer, then <b>Projects</b> to group repositories.
      </p>
    </>
  );
}
