import type { ChangeKind, Scope } from "./changes";

// Normalized records every integration (ClickUp, Jira, GitHub) is converted into. The analysis engine only ever sees these,
// so it works the same no matter where the data came from. Timestamps are epoch milliseconds.
export type Level = "junior" | "mid" | "senior"; // the person's designation
export type Role = "developer" | "designer" | "client_success" | "manager";
export const ROLE_LABEL: Record<Role, string> = { developer: "Developer", designer: "Designer", client_success: "Client-Success", manager: "Manager" };
export const LEVEL_LABEL: Record<Level, string> = { junior: "Junior", mid: "Mid", senior: "Senior" };
// The platform offers two durations: the last 30 days, or everything on record. "All" is a window long enough to hold it all;
// a person is only ever measured from their first interaction, so a long window never dilutes anyone's numbers.
export const ALL_DAYS = 3650;
export const periodLabel = (days: number) => (days >= ALL_DAYS ? "all time" : `the last ${days} days`);
export type Priority = "urgent" | "high" | "normal" | "low";
export type TaskStage = "todo" | "doing" | "review" | "done";

export type Person = {
  id: string;
  name: string;
  level: Level; // designation, set by the CXO; context for forecasting while a person has little history
  role?: Role; // set by the CXO: developers are followed through tasks and GitHub work, everyone else through tasks
  startDate: number; // the first interaction: the earliest task or commit on record
};

export type TaskRec = {
  id: string;
  externalId?: string;
  url?: string; // the task in its own tool, to open it
  personId: string;
  source?: string; // which tool it came from: clickup | jira
  status?: string; // exactly as the tool shows it
  parent?: string; // set when this is a subtask
  // Created or closed in bulk by a data import: the task is real and counted, but its dates are not, so it is left out
  // of speed, on-time and throughput numbers.
  imported?: boolean;
  project: string; // the task list (ClickUp) or project (Jira) it lives in
  title: string;
  priority: Priority;
  stage: TaskStage;
  createdAt: number;
  startedAt?: number;
  doneAt?: number;
  dueAt?: number;
  reopened?: number; // times it came back after being closed (a rework signal). undefined = the source cannot tell (ClickUp), which is not the same as 0
};

// Code activity is described by WHAT each change was and how far it reached, never by lines of code.
export type CommitRec = {
  personId: string;
  repo: string;
  sha: string;
  at: number;
  message: string;
  kind: ChangeKind;
  trivial: boolean; // a merge or housekeeping commit: real, but not a change someone made to the product
  vague: boolean; // the message says nothing ("wip", "update")
  filesChanged?: number;
  prNumber?: number;
  taskId?: string;
};

export type PrRec = {
  personId: string;
  repo: string;
  number: number;
  title: string;
  baseBranch?: string;
  headBranch?: string;
  state: "open" | "merged" | "closed";
  openedAt: number;
  firstReviewAt?: number;
  mergedAt?: number;
  kind: ChangeKind;
  scope: Scope;
  filesChanged?: number;
  commitCount: number;
  reviewRounds: number; // times a reviewer asked for changes
  approvals: number;
  reviewed: boolean; // anyone reviewed it at all
  // A pull request that moves a long-lived branch into another (develop -> staging -> main). It carries other people's
  // already-counted work between environments, so it is a release step, not something its author delivered.
  promotion: boolean;
};

export type Quality = { importedTasks: number; importDays: string[] };
export type Dataset = { people: Person[]; tasks: TaskRec[]; commits: CommitRec[]; prs: PrRec[]; quality?: Quality };

export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
