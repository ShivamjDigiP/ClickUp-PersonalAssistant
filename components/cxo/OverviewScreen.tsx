"use client";

import Link from "next/link";
import { useState } from "react";
import { Bars } from "@/components/Charts";
import { ColumnChart, Kpi } from "@/components/MeCharts";
import { api, useApi } from "./api";
import { LEVEL_LABEL, ROLE_LABEL, type Level, type Role } from "@/lib/analytics/types";
import { Avatar, Btn, dateText, Empty, ErrorBox, PageHeader, Periods, PERIODS, pctText, Section, Sparkline, TableSkeleton, type Note } from "./ui";

type Card = {
  person: { id: string; name: string; level: Level; role?: Role };
  usesCode: boolean;
  notes: Note[];
  completedDelta: number;
  weekly: number[];
  history: { weeks: number; samples: number; confidence: string };
  capacity14d: { low: number; likely: number; high: number } | null;
  metrics: { current: { completed: number; assigned: number; openNow: number; overdueOpen: number; onTimeRate: number | null; commits: number; mergeCommits: number; prsMerged: number; prsOpenNow: number }; previous: { completed: number } };
};
type Overview = {
  days: number;
  hasData: boolean;
  totals: { people: number; assigned: number; completed: number; completedPrev: number; openNow: number; overdueOpen: number; onTimeRate: number | null; commits: number; mergeCommits: number; prsMerged: number; prsOpenNow: number };
  pulse: { active7d: number; withOverdue: number; withOpenPrs: number };
  quality: { importedTasks: number; importDays: string[] };
  cards: Card[];
  risks: { personId: string; name: string; kind: string; message: string }[];
  weekly: { weekStart: number; completed: number; commits: number }[];
  integrations: { id: string; provider: string; label: string; status: string; lastSyncAt: number | null; lastError: string | null }[];
  unlinked: { id: string; externalId: string; commits: number; prs: number }[];
};

export function OverviewScreen() {
  const [days, setDays] = useState(30);
  const [role, setRole] = useState("");
  const { data, error, loading, reload } = useApi<Overview>(`/api/cxo/overview?days=${days}${role ? `&role=${role}` : ""}`);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function syncNow() {
    setSyncing(true);
    setSyncError(null);
    try {
      const out = await api<{ results: ({ ok: boolean; error?: string; label: string })[] }>("/api/cxo/sync", { method: "POST", body: {} });
      const bad = out.results.filter((r) => !r.ok);
      if (bad.length) setSyncError(bad.map((b) => `${b.label}: ${b.error}`).join(" "));
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
      void reload();
    }
  }

  const header = (
    <PageHeader
      title="Team overview"
      sub={role ? `${ROLE_LABEL[role as Role]}s only. The most active come first.` : "What the team has been doing. The most active come first."}
      right={
        <>
          <select aria-label="Show people with this role" value={role} onChange={(e) => setRole(e.target.value)} className="chip !bg-transparent">
            <option value="" className="bg-slate-900">Everyone</option>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r} className="bg-slate-900">{ROLE_LABEL[r]}s</option>)}
          </select>
          <Periods value={days} options={PERIODS} onChange={setDays} />
          <button onClick={syncNow} disabled={syncing || !data?.integrations.length} className={Btn.ghost}>{syncing ? "Syncing…" : "Sync now"}</button>
        </>
      }
    />
  );

  if (error && !data) return <>{header}<ErrorBox message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<TableSkeleton rows={6} /></>;
  if (!data.integrations.length) {
    return (
      <>
        {header}
        <Empty title="Connect your tools to see your team" action={{ href: "/cxo/integrations", label: "Connect ClickUp, GitHub or Jira" }}>
          Connect once and this page fills in with tasks, commits and pull requests for every developer. You will not have to connect again.
        </Empty>
      </>
    );
  }

  const t = data.totals;
  const delta = t.completed - t.completedPrev;
  const lastSync = Math.max(0, ...data.integrations.map((i) => i.lastSyncAt ?? 0));
  const failing = data.integrations.filter((i) => i.status === "error");

  return (
    <>
      {header}

      <div className="mb-5 space-y-2" aria-live="polite">
        {syncError && <ErrorBox message={syncError} />}
        {failing.map((i) => <ErrorBox key={i.id} message={`${i.label} could not sync: ${i.lastError}`} />)}
        {data.quality.importedTasks > 0 && (
          <p className="rounded-xl bg-[rgb(var(--tint)/0.05)] px-4 py-2.5 text-xs text-[var(--muted)]">
            <b className="text-[var(--fg)]">{data.quality.importedTasks} tasks left out:</b> they were created or closed in bulk on {data.quality.importDays.join(", ")} (a data import), so they say nothing about real delivery.
          </p>
        )}
        {data.unlinked.some((u) => u.commits + u.prs > 0) && (
          <p className="rounded-xl bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] px-4 py-2.5 text-xs">
            Some GitHub accounts are not matched to a developer yet, so their commits are missing from the numbers.{" "}
            <Link href="/cxo/people" className="underline underline-offset-2">Match them in People</Link>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <Kpi label="Tasks completed" value={t.completed} accent="var(--teal)" sub={days === 0 ? "in all" : `vs ${t.completedPrev} the period before`} badge={days === 0 || delta === 0 ? null : { text: `${delta > 0 ? "+" : ""}${delta}`, good: delta > 0 }} />
        <Kpi label="Finished on time" value={t.onTimeRate === null ? null : Math.round(t.onTimeRate * 100)} suffix="%" accent="var(--violet)" sub="of tasks that had a due date" />
        <Kpi label="Open tasks" value={t.openNow} accent="var(--amber)" sub={`${t.overdueOpen} overdue`} />
        <Kpi label="Commits" value={t.commits} accent="var(--fg)" sub={t.mergeCommits ? `${t.mergeCommits} only merge branches` : undefined} hint="Commits on GitHub in this period, from developers matched on the People screen. Merge commits are not counted unless the GitHub integration says so." />
        <Kpi label="PRs merged" value={t.prsMerged} accent="var(--fg)" sub={`${data.cards.filter((c) => c.metrics.current.prsMerged > 0).length} people`} />
        <Kpi label="PRs open now" value={t.prsOpenNow} accent="var(--amber)" sub="waiting to be merged" hint="Pull requests that are open on GitHub right now." />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Section title="What is going on" hint="right now">
            <dl className="grid grid-cols-2 gap-3">
              {([
                ["Active this week", data.pulse.active7d, `of ${t.people} people finished a task or committed`],
                ["With overdue tasks", data.pulse.withOverdue, "have open tasks past their due date"],
                ["With open pull requests", data.pulse.withOpenPrs, "have code waiting to be merged"],
              ] as const).map(([k, v, sub]) => (
                <div key={k} className="rounded-xl bg-[rgb(var(--tint)/0.05)] p-3">
                  <dt className="text-[10px] uppercase tracking-widest text-[var(--muted)]">{k}</dt>
                  <dd className="mt-1 text-2xl font-light tabular-nums">{v}</dd>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">{sub}</p>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Worth a look" hint={`${data.risks.length}`}>
            {data.risks.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Nothing is standing out right now.</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {data.risks.slice(0, 8).map((r, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--amber)" }} aria-hidden />
                    <Link href={`/cxo/people/${r.personId}`} className="hover:underline">{r.message}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Section title="Tasks completed per week" hint="last 12 weeks">
          <ColumnChart data={data.weekly.map((w) => ({ label: dateText(w.weekStart), value: w.completed }))} color="var(--teal)" />
        </Section>
        <Section title="Commits per week" hint="last 12 weeks">
          <ColumnChart data={data.weekly.map((w) => ({ label: dateText(w.weekStart), value: w.commits }))} color="var(--violet)" />
        </Section>
        <Section title="Capacity, next 2 weeks" hint="tasks, most likely">
          {data.cards.some((c) => c.capacity14d) ? (
            <Bars data={data.cards.filter((c) => c.capacity14d).sort((a, b) => b.capacity14d!.likely - a.capacity14d!.likely).slice(0, 7).map((c) => ({ label: c.person.name.split(" ")[0], value: Math.round(c.capacity14d!.likely) }))} />
          ) : (
            <p className="text-sm text-[var(--muted)]">Needs a few weeks of history.</p>
          )}
        </Section>
      </div>

      <div className="mt-5">
    <Section title="People" hint={`${t.people}`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
            <tr>
              <th className="pb-2 font-normal">Developer</th>
              <th className="pb-2 font-normal">What is going on</th>
              <th className="pb-2 text-right font-normal">Done</th>
              <th className="pb-2 text-right font-normal">On time</th>
              <th className="pb-2 text-right font-normal">Commits</th>
              <th className="pb-2 text-right font-normal">PRs</th>
              <th className="pb-2 pl-4 font-normal">12 weeks</th>
            </tr>
          </thead>
          <tbody>
            {data.cards.map((c) => (
              <tr key={c.person.id} className="border-t border-[var(--glass-border)] align-middle">
                <td className="py-2.5 pr-3">
                  <Link href={`/cxo/people/${c.person.id}`} className="group flex items-center gap-3">
                    <Avatar name={c.person.name} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate group-hover:underline">{c.person.name}</span>
                      <span className="block text-[11px] text-[var(--muted)]">{c.person.role ? ROLE_LABEL[c.person.role] : "No role set"} · {LEVEL_LABEL[c.person.level]}</span>
                    </span>
                  </Link>
                </td>
                <td className="max-w-[320px] py-2.5 pr-3 text-xs text-[var(--muted)]">
                  {c.notes.filter((n) => n.tone === "attention").slice(0, 2).map((n) => <span key={n.key} className="block">{n.text}</span>)}
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {c.metrics.current.completed}
                  {c.completedDelta !== 0 && <span className="ml-1 text-[10px]" style={{ color: c.completedDelta > 0 ? "var(--teal)" : "var(--coral)" }}>{c.completedDelta > 0 ? "▲" : "▼"}{Math.abs(c.completedDelta)}</span>}
                </td>
                <td className="py-2.5 text-right tabular-nums">{pctText(c.metrics.current.onTimeRate)}</td>
                <td className="py-2.5 text-right tabular-nums">{c.metrics.current.commits}</td>
                <td className="py-2.5 text-right tabular-nums">{c.metrics.current.prsMerged}</td>
                <td className="py-2.5 pl-4"><Sparkline values={c.weekly} color="var(--violet)" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
      </div>

      <p className="mt-6 text-xs text-[var(--muted)]">
        {loading ? "Refreshing…" : `Data synced ${lastSync ? new Date(lastSync).toLocaleString() : "never"}.`} Manage sources under <Link href="/cxo/integrations" className="underline underline-offset-2">Integrations</Link>.
      </p>
    </>
  );
}
