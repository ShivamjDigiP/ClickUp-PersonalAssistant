"use client";

import { useMemo, useState } from "react";
import type { PersonWork } from "@/lib/analytics/personWork";
import { colorForKey, dateText, Section } from "./ui";

// What the developer pushed to GitHub, counted and linked: the commits (each opens on GitHub), and the pull requests
// per repository by state. Nothing is scored or labelled here.
type Code = PersonWork["code"];
const PAGE = 15;
type Tab = "commits" | "prs";
type PrFilter = "all" | "merged" | "open" | "closed";

const STATE: Record<"merged" | "open" | "closed", { label: string; color: string }> = {
  merged: { label: "Merged", color: "var(--teal)" },
  open: { label: "Open", color: "var(--amber)" },
  closed: { label: "Closed, not merged", color: "var(--muted)" },
};

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{children}</span>;
}

const Ext = ({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) => (
  <a href={href} target="_blank" rel="noreferrer" title={title ?? "Open on GitHub"} className="hover:underline">{children} <span aria-hidden className="text-[var(--muted)]">↗</span></a>
);

export function PersonCode({ code, rangeText }: { code: Code; rangeText: string }) {
  const [tab, setTab] = useState<Tab>("commits");
  const [repo, setRepo] = useState("");
  const [hideMerges, setHideMerges] = useState(false);
  const [prFilter, setPrFilter] = useState<PrFilter>("all");
  const [releases, setReleases] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const reset = () => setShown(PAGE);

  const commits = useMemo(() => code.commitItems.filter((c) => (!repo || c.repo === repo) && (!hideMerges || !c.isMerge)), [code.commitItems, repo, hideMerges]);
  const prs = useMemo(
    () => code.prItems.filter((p) => (!repo || p.repo === repo) && (prFilter === "all" || p.state === prFilter) && (releases || !p.release)),
    [code.prItems, repo, prFilter, releases],
  );

  if (code.commits === 0 && code.prsMerged + code.prsOpen + code.prsClosed === 0 && code.releaseMerges === 0) {
    return <Section title="GitHub" hint={rangeText}><p className="text-sm text-[var(--muted)]">No commits or pull requests in this period. If this person does commit, their GitHub account may not be linked yet (People screen).</p></Section>;
  }
  const list = tab === "commits" ? commits : prs;

  return (
    <Section title="GitHub" hint={rangeText}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Commits", code.commits, code.mergeCommits ? `${code.mergeCommits} of them only merge branches` : "merge commits are not counted"],
          ["Pull requests merged", code.prsMerged, code.releaseMerges ? `+ ${code.releaseMerges} release merges between branches` : "in the period"],
          ["Pull requests open", code.prsOpen, "right now"],
          ["Closed, not merged", code.prsClosed, "opened in the period"],
        ].map(([k, v, sub]) => (
          <div key={k as string} className="rounded-xl bg-[rgb(var(--tint)/0.05)] p-3">
            <dt className="text-[10px] uppercase tracking-widest text-[var(--muted)]">{k}</dt>
            <dd className="mt-1 text-2xl font-light tabular-nums">{v}</dd>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{sub}</p>
          </div>
        ))}
      </dl>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]">
            <tr><th className="pb-2 font-normal">Repository</th><th className="pb-2 font-normal">Project</th><th className="pb-2 text-right font-normal">Commits</th><th className="pb-2 text-right font-normal">PRs merged</th><th className="pb-2 text-right font-normal">PRs open</th><th className="pb-2 text-right font-normal">Closed</th></tr>
          </thead>
          <tbody>
            {code.byRepo.map((r) => (
              <tr key={r.repo} className={`border-t border-[var(--glass-border)] ${repo === r.repo ? "bg-[rgb(var(--tint)/0.06)]" : ""}`}>
                <td className="py-2.5 pr-3">
                  <button onClick={() => { setRepo(repo === r.repo ? "" : r.repo); reset(); }} aria-pressed={repo === r.repo} className="text-left hover:underline" title="Show only this repository below">{r.repo}</button>{" "}
                  <a href={r.url} target="_blank" rel="noreferrer" title="Open the repository on GitHub" className="text-[var(--muted)]">↗</a>
                </td>
                <td className="py-2.5 pr-3">{r.project ? <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ color: colorForKey(r.layer ?? "other"), background: `color-mix(in srgb, ${colorForKey(r.layer ?? "other")} 14%, transparent)` }}>{r.project}{r.layer ? ` · ${r.layer}` : ""}{r.part ? ` / ${r.part}` : ""}</span> : <span className="text-[11px] text-[var(--muted)]">not in a project</span>}</td>
                <td className="py-2.5 text-right tabular-nums">{r.commits}</td>
                <td className="py-2.5 text-right tabular-nums">{r.prsMerged}</td>
                <td className="py-2.5 text-right tabular-nums">{r.prsOpen || <span className="text-[var(--muted)]">0</span>}</td>
                <td className="py-2.5 text-right tabular-nums">{r.prsClosed || <span className="text-[var(--muted)]">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Show">
          <button onClick={() => { setTab("commits"); reset(); }} aria-pressed={tab === "commits"} className="chip">Commits <span className="text-[var(--muted)]">{commits.length}</span></button>
          <button onClick={() => { setTab("prs"); reset(); }} aria-pressed={tab === "prs"} className="chip">Pull requests <span className="text-[var(--muted)]">{prs.length}</span></button>
        </div>
        {tab === "commits" ? (
          code.mergeCommits > 0 && <label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" checked={hideMerges} onChange={(e) => { setHideMerges(e.target.checked); reset(); }} className="accent-[var(--violet)]" /> Hide merge commits</label>
        ) : (
          <>
            {(["all", "merged", "open", "closed"] as PrFilter[]).map((f) => <button key={f} onClick={() => { setPrFilter(f); reset(); }} aria-pressed={prFilter === f} className="chip capitalize">{f === "closed" ? "Closed, not merged" : f}</button>)}
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" checked={releases} onChange={(e) => { setReleases(e.target.checked); reset(); }} className="accent-[var(--violet)]" /> Include release merges</label>
          </>
        )}
        {repo && <button onClick={() => { setRepo(""); reset(); }} className="chip">Repository: {repo.split("/").pop()} ✕</button>}
      </div>

      <div className="mt-3 overflow-x-auto">
        {tab === "commits" ? (
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]"><tr><th className="pb-2 font-normal">Commit</th><th className="pb-2 font-normal">Message</th><th className="pb-2 font-normal">Repository</th><th className="pb-2 font-normal">Pull request</th><th className="pb-2 font-normal">Date</th></tr></thead>
            <tbody>
              {commits.slice(0, shown).map((c) => (
                <tr key={`${c.repo}${c.sha}`} className="border-t border-[var(--glass-border)] align-top">
                  <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-xs"><Ext href={c.url}>{c.shortSha}</Ext></td>
                  <td className="max-w-[360px] py-2.5 pr-3">{c.message || <span className="text-[var(--muted)]">(no message)</span>}{c.isMerge && <span className="ml-2 text-[11px] text-[var(--muted)]">merge</span>}</td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">{c.repo.split("/").pop()}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-xs">{c.prNumber ? <Ext href={`https://github.com/${c.repo}/pull/${c.prNumber}`}>#{c.prNumber}</Ext> : <span className="text-[var(--muted)]">direct push</span>}</td>
                  <td className="whitespace-nowrap py-2.5 text-[var(--muted)]">{dateText(c.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-[var(--muted)]"><tr><th className="pb-2 font-normal">Pull request</th><th className="pb-2 font-normal">Repository</th><th className="pb-2 font-normal">State</th><th className="pb-2 font-normal">Branches</th><th className="pb-2 font-normal">Opened</th><th className="pb-2 font-normal">Merged</th><th className="pb-2 font-normal">Review</th></tr></thead>
            <tbody>
              {prs.slice(0, shown).map((p) => (
                <tr key={`${p.repo}${p.number}`} className="border-t border-[var(--glass-border)] align-top">
                  <td className="max-w-[320px] py-2.5 pr-3"><Ext href={p.url}>#{p.number} {p.title}</Ext>{p.release && <span className="ml-2 text-[11px] text-[var(--amber)]">release merge</span>}</td>
                  <td className="py-2.5 pr-3 text-[var(--muted)]">{p.repo.split("/").pop()}</td>
                  <td className="py-2.5 pr-3"><Pill color={STATE[p.state].color}>{STATE[p.state].label}</Pill></td>
                  <td className="py-2.5 pr-3 text-xs text-[var(--muted)]">{p.headBranch ?? "?"} → {p.baseBranch ?? "?"}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--muted)]">{dateText(p.openedAt)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-[var(--muted)]">{p.mergedAt ? dateText(p.mergedAt) : "–"}</td>
                  <td className="whitespace-nowrap py-2.5 text-xs text-[var(--muted)]">{p.changesRequested ? `changes requested${p.changesRequested > 1 ? ` ×${p.changesRequested}` : ""}` : p.approvals ? "approved" : p.reviewed ? "commented" : "no review"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.length === 0 && <p className="py-4 text-sm text-[var(--muted)]">Nothing matches these filters.</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <span>Showing {Math.min(shown, list.length)} of {list.length}{tab === "commits" && code.commits > code.commitItems.length ? ` (the ${code.commitItems.length} newest of ${code.commits})` : ""}</span>
        {shown < list.length && <button onClick={() => setShown((n) => n + 50)} className="chip">Show more</button>}
      </div>
    </Section>
  );
}
