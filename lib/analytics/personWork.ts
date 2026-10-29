import { DAY, type Dataset, type TaskStage } from "./types";
import type { ProjectDef } from "./projects";

// Everything one developer is holding and has produced, in the tools' own words, each item with a link to open it.
//   tasks: every task assigned, finished or still open in the period, by project and status, plus the list itself
//   code:  commits and pull requests per repository, plus the lists themselves
// No scores or labels here: just what exists, counted.
export type Deadline = "on_time" | "late" | "overdue" | "due";

export type TaskItem = {
  id: string;
  title: string;
  url?: string;
  project: string; // the platform project it belongs to, else the task list it lives in
  list: string;
  source: string; // clickup | jira
  status: string; // as the tool shows it
  stage: TaskStage;
  priority: string;
  createdAt: number;
  doneAt?: number;
  dueAt?: number;
  deadline: Deadline | null;
  counted: boolean; // false = part of a bulk import: listed, but left out of the rating
  subtask: boolean; // the task tools count subtasks differently (ClickUp's board hides them by default), so this is shown
};

export type CommitItem = { sha: string; shortSha: string; repo: string; message: string; at: number; url: string; prNumber?: number; isMerge: boolean };
export type PrItem = {
  number: number; repo: string; title: string; state: "open" | "merged" | "closed"; openedAt: number; mergedAt?: number;
  baseBranch?: string; headBranch?: string; url: string; reviewed: boolean; changesRequested: number; approvals: number;
  release: boolean; // moves a long-lived branch into another (develop to main): listed, but not counted as the person's own PR
};
export type RepoRow = { repo: string; url: string; project: string | null; layer: string | null; part: string | null; commits: number; mergeCommits: number; prsMerged: number; prsOpen: number; prsClosed: number };

export type PersonWork = {
  tasks: {
    total: number;
    finished: number; // finished in the period
    open: number; // still open
    overdue: number; // open and past their due date
    notCounted: number;
    subtasks: number; // of the tasks listed, how many are subtasks
    byStatus: { status: string; stage: TaskStage; count: number }[];
    byProject: { project: string; total: number; statuses: Record<string, number> }[];
    items: TaskItem[];
  };
  code: {
    commits: number;
    mergeCommits: number;
    prsMerged: number;
    prsOpen: number;
    prsClosed: number;
    releaseMerges: number;
    byRepo: RepoRow[];
    commitItems: CommitItem[];
    prItems: PrItem[];
  };
};

const GRACE = DAY; // finishing within a day of the due date still counts as on time
const STAGE_ORDER: Record<TaskStage, number> = { todo: 0, doing: 1, review: 2, done: 3 };
const STAGE_NAME: Record<TaskStage, string> = { todo: "to do", doing: "in progress", review: "in review", done: "done" };
export const MAX_TASK_ITEMS = 400;
export const MAX_COMMIT_ITEMS = 600;
export const MAX_PR_ITEMS = 300;

export function deadlineOf(t: { dueAt?: number; doneAt?: number; imported?: boolean }, now: number): Deadline | null {
  if (t.dueAt === undefined) return null;
  if (t.doneAt !== undefined) return t.imported ? "due" : t.doneAt <= t.dueAt + GRACE ? "on_time" : "late"; // an import's finish date says nothing about lateness
  return t.dueAt < now ? "overdue" : "due";
}

export const commitUrl = (repo: string, sha: string) => `https://github.com/${repo}/commit/${sha}`;
export const prUrl = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;

export function personWork(ds: Dataset, personId: string, projects: ProjectDef[], now: number, days: number): PersonWork {
  const from = days > 0 ? now - days * DAY : 0;
  const inWin = (t?: number) => t !== undefined && t >= from && t < now;

  // ---- tasks ----
  const projectOfList = new Map<string, string>();
  for (const p of projects) for (const l of p.taskLists) if (!projectOfList.has(l.toLowerCase())) projectOfList.set(l.toLowerCase(), p.name);
  const mine = ds.tasks.filter((t) => t.personId === personId && (inWin(t.createdAt) || inWin(t.doneAt) || t.doneAt === undefined));
  const items: TaskItem[] = mine.map((t) => ({
    id: t.id,
    title: t.title,
    url: t.url,
    project: projectOfList.get(t.project.toLowerCase()) ?? t.project,
    list: t.project,
    source: t.source ?? "tasks",
    status: t.status || STAGE_NAME[t.stage],
    stage: t.stage,
    priority: t.priority,
    createdAt: t.createdAt,
    doneAt: t.doneAt,
    dueAt: t.dueAt,
    deadline: deadlineOf(t, now),
    counted: !t.imported,
    subtask: !!t.parent,
  }));
  // what needs attention first: open work (overdue, then soonest due), then finished work, newest first
  items.sort((a, b) => {
    const open = (x: TaskItem) => (x.doneAt === undefined ? 0 : 1);
    if (open(a) !== open(b)) return open(a) - open(b);
    if (a.doneAt === undefined) return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
    return (b.doneAt ?? 0) - (a.doneAt ?? 0);
  });

  const byStatus = new Map<string, { status: string; stage: TaskStage; count: number }>();
  const byProject = new Map<string, { project: string; total: number; statuses: Record<string, number> }>();
  for (const t of items) {
    const s = byStatus.get(t.status) ?? { status: t.status, stage: t.stage, count: 0 };
    s.count++;
    byStatus.set(t.status, s);
    const p = byProject.get(t.project) ?? { project: t.project, total: 0, statuses: {} };
    p.total++;
    p.statuses[t.status] = (p.statuses[t.status] ?? 0) + 1;
    byProject.set(t.project, p);
  }

  // ---- code ----
  const refOf = new Map(projects.flatMap((p) => p.repos.map((r) => [r.repo.toLowerCase(), { project: p.name, layer: r.layer, part: r.part }] as const)));
  const rows = new Map<string, RepoRow>();
  const row = (repo: string): RepoRow => {
    let r = rows.get(repo);
    if (!r) {
      const ref = refOf.get(repo.toLowerCase());
      rows.set(repo, (r = { repo, url: `https://github.com/${repo}`, project: ref?.project ?? null, layer: ref?.layer ?? null, part: ref?.part ?? null, commits: 0, mergeCommits: 0, prsMerged: 0, prsOpen: 0, prsClosed: 0 }));
    }
    return r;
  };

  const commits = ds.commits.filter((c) => c.personId === personId && inWin(c.at));
  const commitItems: CommitItem[] = commits
    .map((c) => ({ sha: c.sha, shortSha: c.sha.slice(0, 7), repo: c.repo, message: c.message, at: c.at, url: commitUrl(c.repo, c.sha), prNumber: c.prNumber, isMerge: c.kind === "merge" }))
    .sort((a, b) => b.at - a.at);
  for (const c of commits) {
    const r = row(c.repo);
    r.commits++;
    if (c.kind === "merge") r.mergeCommits++;
  }

  const prItems: PrItem[] = [];
  let releaseMerges = 0;
  for (const p of ds.prs) {
    if (p.personId !== personId) continue;
    const mergedIn = p.state === "merged" && inWin(p.mergedAt);
    const openNow = p.state === "open" && p.openedAt < now;
    const closedIn = p.state === "closed" && inWin(p.openedAt);
    if (!mergedIn && !openNow && !closedIn) continue;
    prItems.push({ number: p.number, repo: p.repo, title: p.title, state: p.state, openedAt: p.openedAt, mergedAt: p.mergedAt, baseBranch: p.baseBranch, headBranch: p.headBranch, url: prUrl(p.repo, p.number), reviewed: p.reviewed, changesRequested: p.reviewRounds, approvals: p.approvals, release: p.promotion });
    if (p.promotion) {
      if (mergedIn) releaseMerges++;
      continue; // listed, never counted as the person's own pull request
    }
    const r = row(p.repo);
    if (mergedIn) r.prsMerged++;
    else if (openNow) r.prsOpen++;
    else r.prsClosed++;
  }
  prItems.sort((a, b) => (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) || (b.mergedAt ?? b.openedAt) - (a.mergedAt ?? a.openedAt));

  const repoRows = [...rows.values()].sort((a, b) => b.commits + b.prsMerged * 3 - (a.commits + a.prsMerged * 3));
  return {
    tasks: {
      total: items.length,
      finished: items.filter((t) => t.doneAt !== undefined).length,
      open: items.filter((t) => t.doneAt === undefined).length,
      overdue: items.filter((t) => t.deadline === "overdue").length,
      notCounted: items.filter((t) => !t.counted).length,
      subtasks: items.filter((t) => t.subtask).length,
      byStatus: [...byStatus.values()].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || b.count - a.count),
      byProject: [...byProject.values()].sort((a, b) => b.total - a.total),
      items: items.slice(0, MAX_TASK_ITEMS),
    },
    code: {
      commits: commits.length,
      mergeCommits: commits.filter((c) => c.kind === "merge").length,
      prsMerged: repoRows.reduce((n, r) => n + r.prsMerged, 0),
      prsOpen: repoRows.reduce((n, r) => n + r.prsOpen, 0),
      prsClosed: repoRows.reduce((n, r) => n + r.prsClosed, 0),
      releaseMerges,
      byRepo: repoRows,
      commitItems: commitItems.slice(0, MAX_COMMIT_ITEMS),
      prItems: prItems.slice(0, MAX_PR_ITEMS),
    },
  };
}
