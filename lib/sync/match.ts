import type { AiMatch, PrNoTaskItem, StatusItem, SyncItem, SyncPr, SyncTask, TaskNoPrItem } from "./types";

// Pure comparison of PRs and tasks (no network), so it is easy to test and fast to run.

const STOP = new Set(["the", "and", "for", "with", "add", "fix", "update", "feat", "feature", "bug", "chore", "into", "from", "this", "that", "when", "pr", "cu"]);

export const tokens = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/cu-[a-z0-9]+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );

// Share of words in common (0..1), relative to the shorter title, so "login page" matches "Add login page validation".
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / Math.min(ta.size, tb.size);
}

const MIN_GUESS = 0.6;
const MIN_WORDS = 2; // one shared word is a coincidence, not a match

export function bestTaskFor(title: string, candidates: SyncTask[]): { task: SyncTask; score: number } | undefined {
  let best: { task: SyncTask; score: number } | undefined;
  for (const task of candidates) {
    const score = similarity(title, task.name);
    const shared = [...tokens(title)].filter((w) => tokens(task.name).has(w)).length;
    if (score >= MIN_GUESS && shared >= MIN_WORDS && (!best || score > best.score)) best = { task, score: Math.round(score * 100) / 100 };
  }
  return best;
}

type Want = (task: SyncTask, prState: "open" | "merged") => string | null;

// Does this PR's state disagree with its task's status? Returns the row to show, or null when they agree.
export function statusItemFor(pr: SyncPr, task: SyncTask, wantedStatus: Want, ai?: AiMatch): StatusItem | null {
  if (pr.state === "closed") return null;
  const behind = (pr.state === "merged" && !task.done) || (pr.state === "open" && task.backlog);
  if (!behind) return null;
  return {
    id: `st:${pr.repo}#${pr.number}:${task.id}`,
    kind: "status",
    pr,
    task,
    want: wantedStatus(task, pr.state),
    why: pr.state === "merged" ? `PR #${pr.number} is merged but the task is still "${task.status}".` : `PR #${pr.number} is open but the task is still "${task.status}".`,
    ...(ai ? { ai } : {}),
  };
}

export type Inputs = {
  prs: SyncPr[];
  mine: SyncTask[]; // the person's tasks
  referenced: Map<string, SyncTask>; // tasks PRs point to, including ones not assigned to the person
  windowStart: string; // YYYY-MM-DD: tasks updated since then count as recent
  wantedStatus: Want;
};

export function reconcile({ prs, mine, referenced, windowStart, wantedStatus }: Inputs) {
  const items: SyncItem[] = [];
  const linkedTaskIds = new Set<string>();
  let inSync = 0;
  const openMine = mine.filter((t) => !t.done);

  for (const pr of prs) {
    if (pr.state === "closed") continue; // closed without merging: nothing to move
    const found = pr.taskIds.map((id) => referenced.get(id)).filter((t): t is SyncTask => !!t);

    if (!found.length) {
      const item: PrNoTaskItem = { id: `pr:${pr.repo}#${pr.number}`, kind: "pr_no_task", pr };
      if (pr.taskIds.length) item.note = `Task ${pr.taskIds.map((i) => i).join(", ")} was not found in ClickUp.`;
      const guess = bestTaskFor(pr.title, openMine);
      if (guess) {
        item.guess = guess;
        linkedTaskIds.add(guess.task.id); // do not also report it as "task without PR"
      }
      items.push(item);
      continue;
    }

    for (const task of found) {
      linkedTaskIds.add(task.id);
      const item = statusItemFor(pr, task, wantedStatus);
      if (item) items.push(item);
      else inSync++;
    }
  }

  // Tasks with no PR: work that is under way or recently finished, but nothing in the chosen repositories points at it.
  const noPr: TaskNoPrItem[] = [];
  for (const task of mine) {
    if (linkedTaskIds.has(task.id)) continue;
    const recent = (task.updated ?? "") >= windowStart;
    if (task.done) {
      if (recent) noPr.push({ id: `tk:${task.id}`, kind: "task_no_pr", task, why: `Done recently ("${task.status}") but no PR found.` });
    } else if (!task.backlog) {
      noPr.push({ id: `tk:${task.id}`, kind: "task_no_pr", task, why: `"${task.status}" but no PR found.` });
    }
  }
  items.push(...noPr);

  return { items, inSync };
}

export type AiMatchResult = { pr: string; task: string | null; confidence: number; reason: string };
export const AI_MIN_CONFIDENCE = 0.6;

// Applies the AI's reading of each PR to the deterministic result. A confident match turns a "PR without a task" into a
// normal linked PR (so it can also show a status mismatch); a weak one is kept as a suggestion only. Tasks that got a
// PR stop being reported as "task without PR".
export function applyAiMatches(items: SyncItem[], matches: AiMatchResult[], tasks: Map<string, SyncTask>, wantedStatus: Want) {
  const byPr = new Map(matches.map((m) => [m.pr, m]));
  const out: SyncItem[] = [];
  const claimed = new Set<string>();
  let matched = 0;
  let inSync = 0;

  for (const item of items) {
    if (item.kind !== "pr_no_task") {
      out.push(item);
      continue;
    }
    const m = byPr.get(`${item.pr.repo}#${item.pr.number}`);
    const task = m?.task ? tasks.get(m.task.toLowerCase()) : undefined;
    if (!m || !task) {
      out.push(item);
      continue;
    }
    const confidence = Math.round(Math.min(Math.max(m.confidence, 0), 1) * 100) / 100;
    if (confidence < AI_MIN_CONFIDENCE) {
      out.push({ ...item, guess: { task, score: confidence, reason: m.reason, ai: true } }); // too unsure to act on
      continue;
    }
    matched++;
    claimed.add(task.id);
    const status = statusItemFor(item.pr, task, wantedStatus, { confidence, reason: m.reason });
    if (status) out.push(status);
    else inSync++;
  }
  return { items: out.filter((i) => !(i.kind === "task_no_pr" && claimed.has(i.task.id))), matched, inSync };
}
