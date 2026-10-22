"use client";

import { useMemo, useState } from "react";
import type { PrNoTaskItem, StatusItem, SyncReport, TaskNoPrItem } from "@/lib/sync/types";

const SHOWN = 4;

const prLabel = (pr: { repo: string; number: number }) => `${pr.repo.split("/")[1] ?? pr.repo}#${pr.number}`;

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-[var(--violet)] underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function Section({ title, tone, count, children, action }: { title: string; tone: string; count: number; children: React.ReactNode[]; action?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  if (!count) return null;
  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wider" style={{ color: tone }}>
          {title} · {count}
        </h4>
        {action}
      </div>
      <ul className="mt-2 space-y-2">{all ? children : children.slice(0, SHOWN)}</ul>
      {children.length > SHOWN && (
        <button className="mt-2 text-xs text-[var(--muted)] underline" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${children.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
}

type Props = {
  report: SyncReport;
  busy: boolean;
  onPropose: (reportId: string, itemIds: string[]) => void;
};

export function SyncCard({ report, busy, onPropose }: Props) {
  const { statusItems, prItems, taskItems } = useMemo(
    () => ({
      statusItems: report.items.filter((i): i is StatusItem => i.kind === "status"),
      prItems: report.items.filter((i): i is PrNoTaskItem => i.kind === "pr_no_task"),
      taskItems: report.items.filter((i): i is TaskNoPrItem => i.kind === "task_no_pr"),
    }),
    [report.items],
  );
  const fixable = statusItems.filter((i) => i.want || i.ai);
  const linkable = prItems.filter((i) => i.guess && !i.guess.ai); // weak AI suggestions are shown, never bulk-applied
  const clean = !report.items.length;

  const action = (label: string, ids: string[]) =>
    ids.length ? (
      <button className="chip" disabled={busy} onClick={() => onPropose(report.id, ids)}>
        {label}
      </button>
    ) : null;

  return (
    <div className="glass rounded-2xl p-4 sm:mr-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {clean ? "Everything lines up" : "Sync result"}{" "}
          <span className="text-xs font-normal text-[var(--muted)]">
            {report.repos.length ? report.repos.join(", ") : "all repositories"} · last {report.days} days
          </span>
        </p>
      </div>
      {report.summary && <p className="mt-2 text-sm leading-relaxed">{report.summary}</p>}
      <p className="mt-1 text-xs text-[var(--muted)]">
        {report.counts.prs} PR{report.counts.prs === 1 ? "" : "s"} checked · {report.counts.inSync} in sync
        {report.counts.status ? ` · ${report.counts.status} need a status update` : ""}
        {report.counts.prNoTask ? ` · ${report.counts.prNoTask} without a task` : ""}
        {report.counts.taskNoPr ? ` · ${report.counts.taskNoPr} tasks without a PR` : ""}
      </p>

      <Section title="PR and task disagree" tone="var(--amber)" count={statusItems.length} action={action(`Propose ${fixable.length} update${fixable.length === 1 ? "" : "s"}`, fixable.map((i) => i.id))}>
        {statusItems.map((i) => (
          <li key={i.id} className="text-xs leading-relaxed">
            <Link href={i.pr.url}>{prLabel(i.pr)}</Link> <span className="text-[var(--muted)]">{i.pr.state}</span> ↔ <Link href={i.task.url}>{i.task.name}</Link>
            <div className="text-[var(--muted)]">
              {i.task.status} → {i.want ?? "update it manually (no matching status in that list)"}
            </div>
            {i.ai && (
              <div className="text-[var(--teal)]">
                AI matched by meaning ({Math.round(i.ai.confidence * 100)}%): <span className="text-[var(--muted)]">{i.ai.reason}</span>
              </div>
            )}
          </li>
        ))}
      </Section>

      <Section title="PRs with no ClickUp task" tone="var(--coral)" count={prItems.length} action={action(`Link ${linkable.length} to the likely task${linkable.length === 1 ? "" : "s"}`, linkable.map((i) => i.id))}>
        {prItems.map((i) => (
          <li key={i.id} className="text-xs leading-relaxed">
            <Link href={i.pr.url}>{prLabel(i.pr)}</Link> {i.pr.title}
            <div className="text-[var(--muted)]">
              {i.note ?? "No task id in the title, description or branch."}
              {i.guess && (
                <>
                  {" "}
                  {i.guess.ai ? "AI suggests (not sure)" : "Likely"}: <Link href={i.guess.task.url}>{i.guess.task.name}</Link> ({Math.round(i.guess.score * 100)}%)
                  {i.guess.reason ? ` - ${i.guess.reason}` : ""}
                </>
              )}
            </div>
          </li>
        ))}
      </Section>

      <Section title="Tasks with no PR" tone="var(--violet)" count={taskItems.length}>
        {taskItems.map((i) => (
          <li key={i.id} className="text-xs leading-relaxed">
            <Link href={i.task.url}>{i.task.name}</Link>
            <div className="text-[var(--muted)]">{i.why}</div>
          </li>
        ))}
      </Section>

      {report.ai?.note && <p className="mt-3 text-[11px] text-[var(--amber)]">{report.ai.note}</p>}
    </div>
  );
}
