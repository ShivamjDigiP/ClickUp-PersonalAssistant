// The result of "Sync ClickUp and GitHub": what the server computes and the chat card shows. Kept small on purpose.
export type SyncPr = {
  repo: string;
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  url: string;
  updated: string;
  draft: boolean;
  taskIds: string[];
};

export type SyncTask = {
  id: string;
  name: string;
  status: string;
  done: boolean;
  backlog: boolean;
  url: string;
  list: string;
  listId: string;
  updated: string | null;
};

// 1. A PR says the task should move, but ClickUp still shows the old status.
export type AiMatch = { confidence: number; reason: string };
export type StatusItem = { id: string; kind: "status"; pr: SyncPr; task: SyncTask; want: string | null; why: string; ai?: AiMatch };
// 2. A PR with no ClickUp task (or one that cannot be found). `guess` is the most likely existing task by title.
export type PrNoTaskItem = { id: string; kind: "pr_no_task"; pr: SyncPr; note?: string; guess?: { task: SyncTask; score: number; reason?: string; ai?: boolean } };
// 3. A ClickUp task that is in progress or done recently, with no PR in the chosen repositories.
export type TaskNoPrItem = { id: string; kind: "task_no_pr"; task: SyncTask; why: string };

export type SyncItem = StatusItem | PrNoTaskItem | TaskNoPrItem;

export type SyncReport = {
  id: string;
  repos: string[];
  days: number;
  at: string;
  counts: { prs: number; tasks: number; inSync: number; status: number; prNoTask: number; taskNoPr: number };
  items: SyncItem[];
  summary?: string; // two plain sentences written by the AI, when it ran
  ai: { used: boolean; engine?: string; matched?: number; note?: string };
  ms: number;
};
