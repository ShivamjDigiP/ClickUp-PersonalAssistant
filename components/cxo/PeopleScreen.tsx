"use client";

import Link from "next/link";
import { useState } from "react";
import { api, useApi } from "./api";
import { Avatar, Btn, Empty, ErrorBox, inputCls, PageHeader, Section, TableSkeleton } from "./ui";
import { LEVEL_LABEL, ROLE_LABEL } from "@/lib/analytics/types";

type Account = { id: string; provider: string; externalId: string; name: string | null; login: string | null; commits: number; tasks: number };
type Person = { id: string; name: string; email: string | null; level: string; role: string | null; firstInteraction: number; active: boolean; accounts: Account[] };
type Unlinked = { id: string; provider: string; externalId: string; name: string | null; email: string | null; commits: number; prs: number; suggestion: { personId: string; name: string; confidence: number; reason: string } | null };

const LEVELS = Object.entries(LEVEL_LABEL);
const ROLES = Object.entries(ROLE_LABEL);
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function PeopleScreen() {
  const { data, error, reload } = useApi<{ people: Person[]; unlinked: Unlinked[] }>("/api/cxo/people");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setProblem(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const patch = (p: Person, body: Record<string, unknown>) => run(p.id, () => api(`/api/cxo/people/${p.id}`, { method: "PATCH", body }));
  const link = (accountId: string, personId: string | null) => run(accountId, () => api(`/api/cxo/identities/${accountId}`, { method: "PUT", body: { personId } }));

  const header = <PageHeader title="People" sub="Everyone found in ClickUp, Jira and GitHub. Set what each person does and their designation, and fix which accounts are theirs." />;
  if (error && !data) return <>{header}<ErrorBox message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<TableSkeleton rows={6} /></>;
  if (!data.people.length && !data.unlinked.length) return <>{header}<Empty title="No people yet" action={{ href: "/cxo/integrations", label: "Connect a tool" }}>People appear here after you connect ClickUp or Jira and run a sync.</Empty></>;

  const active = data.people.filter((p) => p.active);
  const hidden = data.people.filter((p) => !p.active);

  return (
    <>
      {header}
      {problem && <div className="mb-4"><ErrorBox message={problem} /></div>}

      {data.unlinked.length > 0 && (
        <Section title="Accounts to match" hint={`${data.unlinked.length}`} className="mb-5">
          <p className="mb-4 text-sm text-[var(--muted)]">Activity from these accounts is not credited to anyone yet, so it is missing from the dashboards. Confirm the owner and the numbers update straight away.</p>
          <ul className="space-y-2.5">
            {data.unlinked.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[rgb(var(--tint)/0.05)] px-4 py-3">
                <span className="rounded-full bg-[rgb(var(--tint)/0.1)] px-2 py-0.5 text-[10px] uppercase tracking-wider">{u.provider}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{u.externalId}{u.name && u.name !== u.externalId ? <span className="text-[var(--muted)]"> · {u.name}</span> : null}</p>
                  <p className="text-xs text-[var(--muted)]">{u.commits} commits · {u.prs} pull requests</p>
                  {u.suggestion && <p className="mt-1 text-xs">Looks like <b>{u.suggestion.name}</b> <span className="text-[var(--muted)]">({u.suggestion.reason})</span></p>}
                </div>
                {u.suggestion && <button disabled={busy === u.id} onClick={() => link(u.id, u.suggestion!.personId)} className={Btn.primary} style={Btn.primaryStyle}>Yes, link to {u.suggestion.name.split(" ")[0]}</button>}
                <select aria-label={`Link ${u.externalId} to a person`} disabled={busy === u.id} defaultValue="" onChange={(e) => e.target.value && link(u.id, e.target.value)} className={`${inputCls} !w-44`}>
                  <option value="" className="bg-slate-900">{u.suggestion ? "Someone else…" : "Link to…"}</option>
                  {active.map((p) => <option key={p.id} value={p.id} className="bg-slate-900">{p.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="People" hint={`${active.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
              <tr><th className="pb-2 font-normal">Person</th><th className="pb-2 font-normal">Role</th><th className="pb-2 font-normal">Designation</th><th className="pb-2 font-normal" title="The earliest task or commit on record, read from the data">First interaction</th><th className="pb-2 font-normal">Linked accounts</th><th className="pb-2" /></tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id} className="border-t border-[var(--glass-border)] align-middle">
                  <td className="py-2.5 pr-3"><Link href={`/cxo/people/${p.id}`} className="flex items-center gap-2.5 hover:underline"><Avatar name={p.name} size={30} /><span className="min-w-0"><span className="block truncate">{p.name}</span><span className="block truncate text-[11px] text-[var(--muted)]">{p.email}</span></span></Link></td>
                  <td className="py-2.5 pr-3">
                    <select aria-label={`Role of ${p.name}`} value={p.role ?? ""} disabled={busy === p.id} onChange={(e) => patch(p, { role: e.target.value || null })} className={`${inputCls} !w-40 ${p.role ? "" : "!border-[var(--amber)]"}`}>
                      <option value="" className="bg-slate-900">Set a role…</option>
                      {ROLES.map(([v, l]) => <option key={v} value={v} className="bg-slate-900">{l}</option>)}
                    </select>
                  </td>
                  <td className="py-2.5 pr-3">
                    <select aria-label={`Designation of ${p.name}`} value={p.level} disabled={busy === p.id} onChange={(e) => patch(p, { level: e.target.value })} className={`${inputCls} !w-28`}>
                      {LEVELS.map(([v, l]) => <option key={v} value={v} className="bg-slate-900">{l}</option>)}
                    </select>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--muted)]">{day(p.firstInteraction)}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      {p.accounts.map((a) => (
                        <span key={a.id} className="group inline-flex items-center gap-1 rounded-full bg-[rgb(var(--tint)/0.07)] px-2 py-0.5 text-[11px]" title={`${a.commits} commits, ${a.tasks} tasks`}>
                          {a.provider}: {a.login ?? a.name ?? a.externalId}
                          {a.provider === "github" && <button aria-label={`Unlink ${a.externalId}`} onClick={() => link(a.id, null)} className="text-[var(--muted)] hover:text-[var(--coral)]">×</button>}
                        </span>
                      ))}
                      {data.unlinked.length > 0 && (
                        <select aria-label={`Link another account to ${p.name}`} disabled={busy !== null} defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) void link(v, p.id); }} className="rounded-full border border-dashed border-[var(--glass-border)] bg-transparent px-2 py-0.5 text-[11px] text-[var(--muted)]">
                          <option value="" className="bg-slate-900">+ link account</option>
                          {data.unlinked.map((u) => <option key={u.id} value={u.id} className="bg-slate-900">{u.provider}: {u.externalId}</option>)}
                        </select>
                      )}
                      {p.role === "developer" && !p.accounts.some((a) => a.provider === "github") && <span className="text-[11px] text-[var(--amber)]">no GitHub account</span>}
                    </div>
                  </td>
                  <td className="py-2.5 text-right"><button disabled={busy === p.id} onClick={() => patch(p, { active: false })} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]" title="Leave out of the team numbers (for example a bot or someone who has left)">Hide</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">Role decides what is followed: developers through their tasks and GitHub work, everyone else through their tasks. Designation (junior, mid, senior) is context for the AI and for forecasting while someone has little history. First interaction is read from the data: the earliest task given to them or commit they made. None of this changes what anyone actually did.</p>
      </Section>

      {hidden.length > 0 && (
        <Section title="Hidden from the team numbers" hint={`${hidden.length}`} className="mt-5">
          <ul className="flex flex-wrap gap-2">
            {hidden.map((p) => <li key={p.id} className="chip">{p.name} <button onClick={() => patch(p, { active: true })} className="ml-2 underline underline-offset-2">Show</button></li>)}
          </ul>
        </Section>
      )}
    </>
  );
}
