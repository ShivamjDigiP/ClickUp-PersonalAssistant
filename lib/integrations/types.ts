import type { Priority, TaskStage } from "../analytics/types";

// What every adapter produces. The sync engine and the analysis never see ClickUp/GitHub/Jira specifics.
export type Provider = "clickup" | "github" | "jira";

// A person as one tool knows them. The engine links hints from different tools to one developer.
export type PersonHint = { provider: Provider; externalId: string; name?: string; email?: string; login?: string };

export type NormTask = {
  source: Provider;
  externalId: string;
  assignee: PersonHint;
  project: string;
  title: string;
  priority: Priority;
  stage: TaskStage;
  status: string; // the status name exactly as the tool shows it
  parent?: string; // set when this task is a subtask: the parent task's id
  createdAt: number;
  startedAt?: number;
  doneAt?: number;
  dueAt?: number;
  reopened?: number; // undefined = this tool cannot tell
  url?: string;
  updatedAt: number;
};

// A commit, with the text and size facts the analysis reads. additions/deletions are kept in the database but never
// shown or scored: lines of code do not measure work.
export type NormCommit = {
  repo: string;
  sha: string;
  author: PersonHint | null;
  at: number; // when it was written (author date: survives rebases)
  message: string; // first line
  filesChanged?: number;
  parents?: number; // 2+ = a merge commit
  prNumber?: number; // the pull request it was made in, when known
  additions: number;
  deletions: number;
  taskRef?: string;
};

export type NormPr = {
  repo: string;
  number: number;
  author: PersonHint | null;
  title: string;
  state: "open" | "merged" | "closed";
  baseBranch: string;
  headBranch: string;
  labels: string[];
  openedAt: number;
  firstReviewAt?: number;
  mergedAt?: number;
  filesChanged?: number;
  commitCount: number;
  reviewRounds: number; // reviews that asked for changes
  approvals: number;
  reviewed: boolean;
  changelogItems: number; // described changes in the PR description
  additions: number;
  deletions: number;
  taskRef?: string;
};

export type SyncBatch = {
  people: PersonHint[]; // the roster the tool knows (task tools list all members, even those with no tasks yet)
  tasks: NormTask[];
  commits: NormCommit[];
  prs: NormPr[];
  notes: string[]; // anything the CXO should know: "start times unavailable", "repo X skipped", ...
  repos?: string[]; // the repositories this integration covers (GitHub). Only trusted after a FULL sync, to drop data from repos no longer covered
};

export const emptyBatch = (): SyncBatch => ({ people: [], tasks: [], commits: [], prs: [], notes: [] });

export type Check = { ok: true; account: string } | { ok: false; error: string };

export type Adapter<C = Record<string, unknown>> = {
  provider: Provider;
  validate(config: C, secret: string): Promise<Check>;
  sync(config: C, secret: string, range: { since: number; now: number }): Promise<SyncBatch>;
};

export type ClickUpConfig = { teamId?: string };
// excludeMergeCommits defaults to true: merge commits are left out of every number unless the CXO unticks it (see mergePolicy.ts)
export type GitHubConfig = { org?: string; repos?: string[]; maxRepos?: number; excludeMergeCommits?: boolean };
export type JiraConfig = { site: string; email: string; projects?: string[] };

// ---- shared classification helpers -----------------------------------------------------------------------------
const DONE = /^(done|closed|complete|completed|resolved|released|shipped|deployed|finished)$/i;
const REVIEW = /review|qa\b|testing|verif|uat/i;
const DOING = /develop|progress|doing|wip|coding|implement|started/i;

export function stageOfStatus(name: string, done = false): TaskStage {
  if (done || DONE.test(name.trim())) return "done";
  if (REVIEW.test(name)) return "review";
  if (DOING.test(name)) return "doing";
  return "todo";
}

export function priorityOf(name: string | null | undefined): Priority {
  const n = (name ?? "").toLowerCase();
  if (/urgent|highest|blocker|critical/.test(n)) return "urgent";
  if (/high|major/.test(n)) return "high";
  if (/low|minor|trivial/.test(n)) return "low";
  return "normal";
}

// Task ids people write in branches, titles and commit messages: ClickUp "CU-86abc12de" / task URLs, Jira "ABC-123".
const REF = /(?:\bCU-([a-z0-9]{6,12})\b|app\.clickup\.com\/t\/(?:\d+\/)?([a-z0-9]{6,12})\b|\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b)/g;
export function taskRefOf(...texts: (string | null | undefined)[]): string | undefined {
  for (const t of texts) for (const m of (t ?? "").matchAll(REF)) return (m[1] ?? m[2] ?? m[3]).toLowerCase();
  return undefined;
}

export const isBot = (login?: string | null) => !!login && /(\[bot\]|-bot$|^dependabot|^renovate)/i.test(login);
