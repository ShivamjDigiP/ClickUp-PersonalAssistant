import { randomUUID } from "node:crypto";
import { clickup } from "../clickup/client";
import { ms } from "../clickup/data";
import { isBacklog, isDone, myTasks } from "../clickup/me";
import { currentUser, defaultTeamId } from "../clickup/resolve";
import { branchOf, changelogOf, linkedTaskIds, listMyPrs } from "../git/github";
import { kv } from "../kv";
import { ns } from "../auth/context";
import { pool } from "./pool";
import { aiMatch, type PrBrief, type TaskBrief } from "./ai";
import { applyAiMatches, reconcile } from "./match";
import type { SyncPr, SyncReport, SyncTask } from "./types";

// Sync = compare the person's recent GitHub PRs with their ClickUp tasks. No AI is involved: it is a few API calls and a
// comparison, so it is fast, free and gives the same answer every time.
export const reportKey = (id: string) => ns(`sync/${id}`);
export const REPORT_TTL_SEC = 15 * 60;

const MAX_BRANCH_LOOKUPS = 12;
const MAX_EXTRA_TASKS = 20;
const MAX_AI_PRS = 12;
const MAX_AI_TASKS = 60;

function toTask(t: any): SyncTask {
  return {
    id: String(t.id).toLowerCase(),
    name: t.name,
    status: t.status?.status ?? "",
    done: isDone(t),
    backlog: isBacklog(t),
    url: t.url,
    list: t.list?.name ?? "",
    listId: t.list?.id ?? "",
    updated: ms(t.date_updated),
  };
}

export type SyncOptions = { ai: boolean; local: boolean };

export async function runSync(repos: string[], days: number, { ai, local }: SyncOptions = { ai: false, local: false }): Promise<SyncReport> {
  const started = Date.now();
  const [rawPrs, me, teamId] = await Promise.all([listMyPrs("all", days, repos, 50, true), currentUser(), defaultTeamId()]);
  const rawMine = await myTasks(teamId, Number(me.id));
  const mine = rawMine.map(toTask);
  const taskText = new Map(rawMine.map((t) => [String(t.id).toLowerCase(), String(t.text_content ?? t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160)]));
  const bodies = new Map(rawPrs.map((p) => [`${p.repo}#${p.number}`, String((p as { body?: string }).body ?? "")]));

  const prs: SyncPr[] = rawPrs.map((p) => ({
    repo: p.repo,
    number: p.number,
    title: p.title,
    state: p.state === "merged" ? "merged" : p.state === "open" ? "open" : "closed",
    url: p.url,
    updated: p.updated,
    draft: p.draft,
    taskIds: p.clickup_task_ids,
  }));

  // Branch names like feature/CU-86abc often carry the task id when the title does not.
  const unlinked = prs.filter((p) => p.state !== "closed" && !p.taskIds.length).slice(0, MAX_BRANCH_LOOKUPS);
  await pool(unlinked, 4, async (p) => {
    const branch = await branchOf(p.repo, p.number);
    p.taskIds = linkedTaskIds(branch);
  });

  // Tasks the PRs point to, including ones assigned to someone else.
  const referenced = new Map(mine.map((t) => [t.id, t]));
  const missing = [...new Set(prs.flatMap((p) => p.taskIds))].filter((id) => !referenced.has(id)).slice(0, MAX_EXTRA_TASKS);
  await pool(missing, 4, async (id) => {
    try {
      referenced.set(id, toTask(await clickup<any>(`/task/${id}`)));
    } catch {
      /* not found: reported as "task not found" on the PR */
    }
  });

  // Which status would "done" / "in progress" be in each affected list? Looked up once per list.
  const listIds = [...new Set([...referenced.values()].map((t) => t.listId).filter(Boolean))];
  const statuses = new Map<string, { status: string; type: string }[]>();
  await pool(listIds, 4, async (id) => {
    try {
      statuses.set(id, (await clickup<{ statuses: { status: string; type: string }[] }>(`/list/${id}`)).statuses ?? []);
    } catch {
      statuses.set(id, []);
    }
  });
  const wantedStatus = (task: SyncTask, prState: "open" | "merged") => {
    const list = statuses.get(task.listId) ?? [];
    if (prState === "merged") return (list.find((s) => s.type === "done") ?? list.find((s) => s.type === "closed"))?.status ?? null;
    return list.find((s) => s.type === "custom" && /progress|doing|develop|working|active/i.test(s.status))?.status ?? null;
  };

  const windowStart = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  let { items, inSync } = reconcile({ prs, mine, referenced, windowStart, wantedStatus });
  let summary: string | undefined;
  let aiInfo: SyncReport["ai"] = { used: false, note: ai ? undefined : "AI matching was turned off." };

  // PRs the id/branch/title rules could not place: let a model read their changelog and match them to tasks by meaning
  const unmatched = items.filter((i) => i.kind === "pr_no_task").slice(0, MAX_AI_PRS);
  if (ai && unmatched.length) {
    try {
      const briefs: PrBrief[] = await pool(unmatched, 4, async (i) => {
        const pr = (i as { pr: SyncPr }).pr;
        const key = `${pr.repo}#${pr.number}`;
        const changelog = await changelogOf(pr.repo, pr.number);
        const description = (bodies.get(key) ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
        const text = changelog ?? description;
        return { key, title: pr.title, state: pr.state, text, source: changelog ? "changelog" : description ? "description" : "title" };
      });
      const candidates: TaskBrief[] = mine
        .filter((t) => !t.done || (t.updated ?? "") >= windowStart)
        .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
        .slice(0, MAX_AI_TASKS)
        .map((t) => ({ id: t.id, name: t.name, status: t.status, list: t.list, desc: taskText.get(t.id) ?? "" }));
      const findings = items.filter((i) => i.kind === "status").map((i) => (i.kind === "status" ? `${i.pr.repo}#${i.pr.number} ${i.pr.state} but task "${i.task.name}" is "${i.task.status}"` : ""));
      const result = await aiMatch(briefs, candidates, findings, local);
      const applied = applyAiMatches(items, result.matches, new Map(mine.map((t) => [t.id, t])), wantedStatus);
      items = applied.items;
      inSync += applied.inSync;
      summary = result.summary;
      aiInfo = { used: true, engine: result.engine, matched: applied.matched };
    } catch (e) {
      aiInfo = { used: false, note: `AI matching was unavailable (${(e as Error).message.slice(0, 120)}). Showing word-overlap guesses instead.` };
    }
  }

  const report: SyncReport = {
    id: randomUUID(),
    repos,
    days,
    at: new Date().toISOString(),
    counts: {
      prs: prs.length,
      tasks: mine.filter((t) => !t.done || (t.updated ?? "") >= windowStart).length,
      inSync,
      status: items.filter((i) => i.kind === "status").length,
      prNoTask: items.filter((i) => i.kind === "pr_no_task").length,
      taskNoPr: items.filter((i) => i.kind === "task_no_pr").length,
    },
    items,
    summary,
    ai: aiInfo,
    ms: Date.now() - started,
  };
  await kv().set(reportKey(report.id), report, REPORT_TTL_SEC);
  return report;
}

// What the model is told about a sync, so follow-up questions ("which of those are urgent?") work. Compact on purpose.
export function reportDigest(r: SyncReport): string {
  const lines = [...(r.summary ? [r.summary] : []), `Sync result (${r.repos.length ? r.repos.join(", ") : "all repos"}, last ${r.days} days): ${r.counts.prs} PRs, ${r.counts.inSync} in sync.`];
  for (const i of r.items.slice(0, 25)) {
    if (i.kind === "status") lines.push(`- STATUS: ${i.pr.repo}#${i.pr.number} (${i.pr.state}) -> task ${i.task.id} "${i.task.name}" is "${i.task.status}"${i.want ? `, should be "${i.want}"` : ""}${i.ai ? ` (AI match ${Math.round(i.ai.confidence * 100)}%: ${i.ai.reason})` : ""}`);
    else if (i.kind === "pr_no_task") lines.push(`- PR WITHOUT TASK: ${i.pr.repo}#${i.pr.number} "${i.pr.title}"${i.guess ? ` (maybe task ${i.guess.task.id} "${i.guess.task.name}")` : ""}`);
    else lines.push(`- TASK WITHOUT PR: ${i.task.id} "${i.task.name}" (${i.task.status})`);
  }
  return lines.join("\n");
}
