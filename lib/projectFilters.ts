// Filtering logic for the project page. Pure functions (no React) so it is easy to test.
// Rules: different filters combine with AND, values inside one filter combine with OR.
export type Stage = "backlog" | "progress" | "done";
export type Flag = "overdue" | "soon" | "stale";
export type SortKey = "due" | "updated" | "priority" | "created";
export type Priority = "urgent" | "high" | "normal" | "low" | "none";

export type PTask = {
  id: string;
  name: string;
  url: string;
  status: string;
  stage: Stage;
  assignees: { id: number; name: string }[];
  priority: Priority;
  due: number | null;
  created: number;
  updated: number;
  closed: number | null;
};

export type Filters = {
  q: string;
  statuses: string[];
  people: string[]; // assignee ids as strings, or "none" for unassigned
  priorities: Priority[];
  stages: Stage[];
  flags: Flag[];
  sort: SortKey;
};

export type Dim = "q" | "statuses" | "people" | "priorities" | "stages" | "flags";

export const EMPTY: Filters = { q: "", statuses: [], people: [], priorities: [], stages: [], flags: [], sort: "due" };
export const DAY = 86_400_000;
export const NONE = "none";

export const flagsOf = (t: PTask, now: number): Flag[] => {
  if (t.stage === "done") return [];
  const f: Flag[] = [];
  if (t.due && t.due < now) f.push("overdue");
  else if (t.due && t.due < now + 7 * DAY) f.push("soon");
  if (t.updated < now - 7 * DAY) f.push("stale");
  return f;
};

export const peopleKeys = (t: PTask) => (t.assignees.length ? t.assignees.map((a) => String(a.id)) : [NONE]);

// `skip` leaves one filter out: that lets a chart show the other options of its own filter
// (e.g. all statuses) while still reacting to every other filter.
export function matches(t: PTask, f: Filters, now: number, skip?: Dim): boolean {
  if (skip !== "q" && f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    const hay = `${t.name} ${t.status} ${t.assignees.map((a) => a.name).join(" ")}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (skip !== "statuses" && f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (skip !== "people" && f.people.length && !peopleKeys(t).some((k) => f.people.includes(k))) return false;
  if (skip !== "priorities" && f.priorities.length && !f.priorities.includes(t.priority)) return false;
  if (skip !== "stages" && f.stages.length && !f.stages.includes(t.stage)) return false;
  if (skip !== "flags" && f.flags.length && !flagsOf(t, now).some((x) => f.flags.includes(x))) return false;
  return true;
}

export const activeCount = (f: Filters) =>
  (f.q.trim() ? 1 : 0) + f.statuses.length + f.people.length + f.priorities.length + f.stages.length + f.flags.length;

export const toggle = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 };

export function sortTasks(tasks: PTask[], key: SortKey): PTask[] {
  const open = (t: PTask) => (t.stage === "done" ? 1 : 0);
  const by: Record<SortKey, (a: PTask, b: PTask) => number> = {
    // open work first, soonest due first, undated last
    due: (a, b) => open(a) - open(b) || (a.due ?? Infinity) - (b.due ?? Infinity) || b.updated - a.updated,
    updated: (a, b) => b.updated - a.updated,
    priority: (a, b) => open(a) - open(b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due ?? Infinity) - (b.due ?? Infinity),
    created: (a, b) => b.created - a.created,
  };
  return [...tasks].sort(by[key]);
}

// ---- URL <-> filters, so a filtered view can be shared or reloaded
export function toParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  f.statuses.forEach((s) => p.append("status", s));
  f.people.forEach((s) => p.append("person", s));
  f.priorities.forEach((s) => p.append("priority", s));
  f.stages.forEach((s) => p.append("stage", s));
  f.flags.forEach((s) => p.append("flag", s));
  if (f.sort !== EMPTY.sort) p.set("sort", f.sort);
  return p;
}

const STAGES: Stage[] = ["backlog", "progress", "done"];
const FLAGS: Flag[] = ["overdue", "soon", "stale"];
const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low", "none"];
const SORTS: SortKey[] = ["due", "updated", "priority", "created"];

export function fromParams(p: URLSearchParams): Filters {
  const sort = p.get("sort") as SortKey;
  return {
    q: p.get("q") ?? "",
    statuses: p.getAll("status"),
    people: p.getAll("person"),
    priorities: p.getAll("priority").filter((x): x is Priority => PRIORITIES.includes(x as Priority)),
    stages: p.getAll("stage").filter((x): x is Stage => STAGES.includes(x as Stage)),
    flags: p.getAll("flag").filter((x): x is Flag => FLAGS.includes(x as Flag)),
    sort: SORTS.includes(sort) ? sort : EMPTY.sort,
  };
}
