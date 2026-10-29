import { db } from "../db";
import { changelogItems, classifyCommit, classifyPr, scopeOf } from "./changes";
import { mergeCommitsShown } from "../integrations/mergePolicy";
import { cleanDataset } from "./clean";
import type { CommitRec, Dataset, Level, Priority, PrRec, Role, TaskStage } from "./types";

const LONG_LIVED = /^(main|master|develop|development|dev|staging|stage|production|prod|release.*|uat|qa|pre-?(develop|prod|production|release|staging).*)$/i;

// Builds the analysis input from the database: real people, with their tasks, commits and PRs from every connected tool
// added up under one person (that is what the identity links are for). Unlinked activity is left out of the totals.
// Commits and PRs are classified here from their stored text (what the change was) and size (how far it reached).
export function loadDataset(workspaceId: string): Dataset {
  const d = db();
  const people = (d.prepare("SELECT id, name, level, role, start_date FROM people WHERE workspace_id = ? AND active = 1").all(workspaceId) as any[]).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    level: p.level as Level,
    role: ((p.role as string | null) ?? undefined) as Role | undefined,
    startDate: p.start_date as number,
  }));

  const tasks = (
    d
      .prepare(
        `SELECT t.external_id, t.source, t.project, t.title, t.priority, t.stage, t.status, t.parent, t.url, t.created_at, t.started_at, t.done_at, t.due_at, t.reopened, i.person_id
         FROM tasks t JOIN identities i ON i.id = t.identity_id WHERE t.workspace_id = ? AND i.person_id IS NOT NULL`,
      )
      .all(workspaceId) as any[]
  ).map((t) => ({
    id: `${t.source}:${t.external_id}`,
    externalId: t.external_id as string,
    url: (t.url as string | null) ?? undefined,
    status: (t.status as string | null) ?? undefined,
    parent: (t.parent as string | null) ?? undefined,
    personId: t.person_id as string,
    source: t.source as string,
    project: t.project as string,
    title: t.title as string,
    priority: t.priority as Priority,
    stage: t.stage as TaskStage,
    createdAt: t.created_at as number,
    startedAt: t.started_at ?? undefined,
    doneAt: t.done_at ?? undefined,
    dueAt: t.due_at ?? undefined,
    reopened: t.reopened ?? undefined,
  }));

  const showMerges = mergeCommitsShown(workspaceId);
  const commits: CommitRec[] = (
    d
      .prepare(
        `SELECT c.repo, c.sha, c.at, c.message, c.files_changed, c.parents, c.pr_number, c.task_ref, i.person_id
         FROM commits c JOIN identities i ON i.id = c.identity_id WHERE c.workspace_id = ? AND i.person_id IS NOT NULL`,
      )
      .all(workspaceId) as any[]
  ).map((c) => {
    const k = classifyCommit(c.message ?? "", c.parents ?? 1);
    return { personId: c.person_id as string, repo: c.repo as string, sha: c.sha as string, at: c.at as number, message: (c.message as string | null) ?? "", kind: k.kind, trivial: k.trivial, vague: k.vague, filesChanged: c.files_changed ?? undefined, prNumber: c.pr_number ?? undefined, taskId: c.task_ref ?? undefined };
  }).filter((c) => c.kind !== "merge" || showMerges(c.repo)); // merge commits are left out unless the integration says to count them

  // a branch other pull requests merge INTO is a long-lived branch; a PR coming FROM one is a promotion between environments
  const baseBranches = new Map<string, Set<string>>();
  for (const r of d.prepare("SELECT repo, base_branch FROM pull_requests WHERE workspace_id = ? AND base_branch IS NOT NULL").all(workspaceId) as { repo: string; base_branch: string }[]) {
    const set = baseBranches.get(r.repo) ?? new Set<string>();
    set.add(r.base_branch);
    baseBranches.set(r.repo, set);
  }
  const promotion = (repo: string, head: string | null) => !!head && (baseBranches.get(repo)?.has(head) || LONG_LIVED.test(head));

  const prs: PrRec[] = (
    d
      .prepare(
        `SELECT p.repo, p.number, p.title, p.state, p.base_branch, p.head_branch, p.labels, p.opened_at, p.first_review_at, p.merged_at, p.files_changed,
                p.commit_count, p.review_rounds, p.approvals, p.reviewed, p.changelog_items, i.person_id
         FROM pull_requests p JOIN identities i ON i.id = p.identity_id WHERE p.workspace_id = ? AND i.person_id IS NOT NULL`,
      )
      .all(workspaceId) as any[]
  ).map((p) => ({
    personId: p.person_id as string,
    repo: p.repo as string,
    number: p.number as number,
    title: (p.title as string | null) ?? "",
    baseBranch: (p.base_branch as string | null) ?? undefined,
    headBranch: (p.head_branch as string | null) ?? undefined,
    state: (p.state ?? (p.merged_at ? "merged" : "open")) as PrRec["state"],
    openedAt: p.opened_at as number,
    firstReviewAt: p.first_review_at ?? undefined,
    mergedAt: p.merged_at ?? undefined,
    kind: classifyPr(p.title ?? "", String(p.labels ?? "").split(",").filter(Boolean), p.head_branch ?? ""),
    scope: scopeOf(p.files_changed, p.changelog_items ?? 0, p.commit_count ?? 1),
    filesChanged: p.files_changed ?? undefined,
    commitCount: p.commit_count ?? 1,
    reviewRounds: p.review_rounds ?? 0,
    approvals: p.approvals ?? 0,
    reviewed: !!p.reviewed,
    promotion: promotion(p.repo, p.head_branch),
  }));

  const ds = cleanDataset({ people, tasks, commits, prs });
  // A person's start is their first interaction: the earliest task given to them or commit / pull request of theirs. Tasks
  // created in a bulk import say nothing about when anyone started, so they are not used.
  const first = firstInteractions(ds);
  return { ...ds, people: ds.people.map((p) => ({ ...p, startDate: first.get(p.id) ?? p.startDate })) };
}

export function firstInteractions(ds: Dataset): Map<string, number> {
  const first = new Map<string, number>();
  const see = (id: string, at: number) => at > 0 && first.set(id, Math.min(first.get(id) ?? Infinity, at));
  for (const t of ds.tasks) if (!t.imported) see(t.personId, t.createdAt);
  for (const c of ds.commits) see(c.personId, c.at);
  for (const p of ds.prs) see(p.personId, p.openedAt);
  return first;
}

// Keeps the stored start date equal to the first interaction, so the People screen shows it and nothing has to be typed in.
export function persistFirstInteractions(workspaceId: string) {
  const update = db().prepare("UPDATE people SET start_date = ? WHERE id = ? AND workspace_id = ? AND start_date <> ?");
  for (const p of loadDataset(workspaceId).people) update.run(p.startDate, p.id, workspaceId, p.startDate);
}

export { changelogItems };

// Activity from accounts nobody has been matched to yet: the CXO needs to see this to fix it.
export function unlinkedAccounts(workspaceId: string) {
  return db()
    .prepare(
      `SELECT i.id, i.provider, i.external_id AS externalId, i.display_name AS name, i.email,
         (SELECT COUNT(*) FROM commits c WHERE c.identity_id = i.id) AS commits,
         (SELECT COUNT(*) FROM pull_requests p WHERE p.identity_id = i.id) AS prs
       FROM identities i WHERE i.workspace_id = ? AND i.person_id IS NULL ORDER BY commits DESC`,
    )
    .all(workspaceId) as { id: string; provider: string; externalId: string; name: string | null; email: string | null; commits: number; prs: number }[];
}
