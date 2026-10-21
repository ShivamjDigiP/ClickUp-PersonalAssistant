import { clickup } from "./client";
import { slimTask, type SlimTask } from "./data";
import { loadHierarchy } from "./resolve";

// Everything on the "Me" tab is computed here from real ClickUp data: your assigned tasks
// (open and closed) plus your tracked time. Nothing is estimated or invented.
const DAY = 86_400_000;

export type ProjectRow = { id: string; name: string; assigned: number; done: number; open: number; progress: number };

export type MeStats = {
  days: number;
  generatedAt: string;
  user: { name: string; email: string; avatar: string | null };
  workspace: string;
  // Where I work: workspace > space > folder > project (list). Only places where I have tasks.
  tree: {
    space: string;
    folders: { name: string | null; projects: ProjectRow[] }[]; // name null = lists directly in the space
  }[];
  totals: { assigned: number; open: number; done: number; completionRate: number; overdueOpen: number; dueSoon: number };
  stages: { backlog: number; inProgress: number; done: number };
  openByStatus: { label: string; value: number }[];
  backlog: (SlimTask & { ageDays: number; path: string })[];
  projectCount: number;
  projects: (ProjectRow & { space: string; folder: string | null })[];
  impact: {
    completed: number;
    completedPrev: number;
    points: number;
    priorityMix: { urgent: number; high: number; normal: number; low: number; none: number };
    onTimeRate: number | null;
    medianCycleDays: number | null;
  };
  weekly: { start: string; completed: number; created: number }[];
  heat: { date: string; count: number }[];
  streak: { current: number; best: number };
  effort: {
    tracked: boolean;
    hours: number;
    daily: { date: string; hours: number }[];
    byProject: { label: string; value: number }[];
  };
  insights: string[];
};

export const isDone = (t: any) => t.status?.type === "closed" || t.status?.type === "done";
const BACKLOG = /backlog|to ?do|open|new|not started|queued|icebox|triage/i;
export const isBacklog = (t: any) => !isDone(t) && (t.status?.type === "open" || BACKLOG.test(t.status?.status ?? ""));
const completedAt = (t: any): number | null =>
  isDone(t) ? Number(t.date_done ?? t.date_closed ?? t.date_updated) || null : null;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const WEIGHT: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 }; // impact points per completed task

async function fetchMyTasks(teamId: string, userId: number) {
  const out: any[] = [];
  for (let page = 0; page < 10; page++) {
    const data = await clickup<{ tasks: any[]; last_page?: boolean }>(`/team/${teamId}/task`, {
      assignees: [userId],
      include_closed: true,
      subtasks: true,
      page,
    });
    out.push(...data.tasks);
    if (data.last_page || data.tasks.length < 100) break;
  }
  return out;
}

// One shared, short-lived copy of "my tasks" so Pulse, Me and chat all agree and ClickUp is hit once.
const taskCache = new Map<string, { at: number; tasks: any[] }>();
export async function myTasks(teamId: string, userId: number) {
  const key = `${teamId}:${userId}`;
  const hit = taskCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.tasks;
  const tasks = await fetchMyTasks(teamId, userId);
  taskCache.set(key, { at: Date.now(), tasks });
  return tasks;
}

export type Engaged = { id: string; name: string; folder: string | null; assigned: number; done: number };

// "My projects" = every list where I have (or had) a task assigned. This single definition
// drives the Pulse "My projects" view and the Me tab, so the numbers always match.
export function engagedLists(tasks: any[]): Map<string, Engaged> {
  const byList = new Map<string, Engaged>();
  for (const t of tasks) {
    const id = t.list?.id;
    if (!id) continue;
    const e = byList.get(id) ?? { id, name: t.list.name, folder: t.folder?.name && t.folder.name !== "hidden" ? t.folder.name : null, assigned: 0, done: 0 };
    e.assigned++;
    if (isDone(t)) e.done++;
    byList.set(id, e);
  }
  return byList;
}

async function fetchTime(teamId: string, userId: number, from: number, to: number) {
  try {
    const r = await clickup<{ data: any[] }>(`/team/${teamId}/time_entries`, { start_date: from, end_date: to, assignee: userId });
    return r.data ?? [];
  } catch {
    return null; // time tracking not enabled for this workspace/plan
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function computeMe(days = 30): Promise<MeStats> {
  const now = Date.now();
  const [{ user }, { teams }] = await Promise.all([clickup<{ user: any }>("/user"), clickup<{ teams: any[] }>("/team")]);
  const team = teams[0];
  if (!team) throw new Error("No ClickUp workspace found.");

  const [tasks, time, hierarchy] = await Promise.all([
    myTasks(team.id, user.id),
    fetchTime(team.id, user.id, now - Math.max(days, 30) * DAY, now),
    loadHierarchy(String(team.id)).catch(() => []),
  ]);

  // Where each list lives: space and (optional) folder. Archived/hidden lists fall back to "Other".
  const where = new Map<string, { space: string; folder: string | null }>();
  for (const h of hierarchy) {
    for (const l of h.folderless_lists) where.set(l.id, { space: h.space.name, folder: null });
    for (const f of h.folders) for (const l of f.lists) where.set(l.id, { space: h.space.name, folder: f.name });
  }
  const locate = (id: string) => where.get(id) ?? { space: "Other", folder: null };
  const pathOf = (id: string) => {
    const w = locate(id);
    return w.folder ? `${w.space} / ${w.folder}` : w.space;
  };

  const open = tasks.filter((t) => !isDone(t));
  const done = tasks.filter(isDone);
  const backlogTasks = open.filter(isBacklog);
  const overdueOpen = open.filter((t) => t.due_date && Number(t.due_date) < now).length;
  const dueSoon = open.filter((t) => t.due_date && Number(t.due_date) >= now && Number(t.due_date) < now + 7 * DAY).length;

  // ---- statuses & stages
  const statusCounts: Record<string, number> = {};
  for (const t of open) statusCounts[t.status?.status ?? "unknown"] = (statusCounts[t.status?.status ?? "unknown"] ?? 0) + 1;
  const openByStatus = Object.entries(statusCounts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const backlog = backlogTasks
    .map((t) => ({
      ...slimTask(t),
      ageDays: Math.max(0, Math.floor((now - Number(t.date_created)) / DAY)),
      path: pathOf(t.list?.id),
    }))
    .sort((a, b) => (rank[a.priority ?? ""] ?? 4) - (rank[b.priority ?? ""] ?? 4) || b.ageDays - a.ageDays)
    .slice(0, 8);

  // ---- projects (lists) I'm part of
  const allProjects = [...engagedLists(tasks).values()].sort((a, b) => b.assigned - a.assigned);
  const row = (p: (typeof allProjects)[number]): ProjectRow => ({
    id: p.id,
    name: p.name,
    assigned: p.assigned,
    done: p.done,
    open: p.assigned - p.done,
    progress: Math.round((p.done / p.assigned) * 100),
  });
  const projects = allProjects.slice(0, 8).map((p) => ({ ...row(p), ...locate(p.id) }));

  // workspace > space > folder > project, ordered by how much work I have in each
  const tree: MeStats["tree"] = [];
  for (const p of allProjects) {
    const w = locate(p.id);
    let space = tree.find((s) => s.space === w.space);
    if (!space) tree.push((space = { space: w.space, folders: [] }));
    let folder = space.folders.find((f) => f.name === w.folder);
    if (!folder) space.folders.push((folder = { name: w.folder, projects: [] }));
    folder.projects.push(row(p));
  }
  const weight = (xs: ProjectRow[]) => xs.reduce((n, p) => n + p.assigned, 0);
  for (const s of tree) s.folders.sort((a, b) => weight(b.projects) - weight(a.projects));
  tree.sort((a, b) => weight(b.folders.flatMap((f) => f.projects)) - weight(a.folders.flatMap((f) => f.projects)));

  // ---- impact
  const from = now - days * DAY;
  const prevFrom = now - 2 * days * DAY;
  const doneInPeriod = done.filter((t) => (completedAt(t) ?? 0) >= from);
  const donePrev = done.filter((t) => {
    const c = completedAt(t) ?? 0;
    return c >= prevFrom && c < from;
  });
  const mix = { urgent: 0, high: 0, normal: 0, low: 0, none: 0 };
  let points = 0;
  for (const t of doneInPeriod) {
    const p = t.priority?.priority as keyof typeof mix | undefined;
    if (p && p in mix) mix[p]++;
    else mix.none++;
    points += WEIGHT[p ?? ""] ?? 1;
  }
  const withDue = doneInPeriod.filter((t) => t.due_date);
  const onTime = withDue.filter((t) => (completedAt(t) ?? 0) <= Number(t.due_date) + DAY).length; // 1 day grace
  const cycle = doneInPeriod
    .map((t) => ((completedAt(t) ?? 0) - Number(t.date_created)) / DAY)
    .filter((d) => d >= 0);

  // ---- weekly trend (8 weeks) and 12-week heat map
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = now - (8 - i) * 7 * DAY;
    const end = start + 7 * DAY;
    return {
      start: new Date(start).toISOString(),
      completed: done.filter((t) => { const c = completedAt(t) ?? 0; return c >= start && c < end; }).length,
      created: tasks.filter((t) => { const c = Number(t.date_created); return c >= start && c < end; }).length,
    };
  });
  const perDay = new Map<string, number>();
  for (const t of done) {
    const c = completedAt(t);
    if (c && c >= now - 84 * DAY) perDay.set(dayKey(c), (perDay.get(dayKey(c)) ?? 0) + 1);
  }
  const heat = Array.from({ length: 84 }, (_, i) => {
    const date = dayKey(now - (83 - i) * DAY);
    return { date, count: perDay.get(date) ?? 0 };
  });
  let best = 0;
  let run = 0;
  for (const d of heat) {
    run = d.count ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let i = heat.length - 1; i >= 0; i--) {
    if (heat[i].count) current++;
    else if (i === heat.length - 1) continue; // today may simply not have happened yet
    else break;
  }

  // ---- effort (tracked time)
  const entries = (time ?? []).filter((e) => Number(e.start) >= from);
  const dailyMap = new Map<string, number>();
  const projMap = new Map<string, number>();
  let totalMs = 0;
  for (const e of entries) {
    const d = Number(e.duration) || 0;
    totalMs += d;
    dailyMap.set(dayKey(Number(e.start)), (dailyMap.get(dayKey(Number(e.start))) ?? 0) + d);
    const name = e.task_location?.list_name ?? "Other";
    projMap.set(name, (projMap.get(name) ?? 0) + d);
  }
  const bars = Math.min(days, 30);
  const daily = Array.from({ length: bars }, (_, i) => {
    const date = dayKey(now - (bars - 1 - i) * DAY);
    return { date, hours: +((dailyMap.get(date) ?? 0) / 3_600_000).toFixed(1) };
  });
  const byProject = [...projMap.entries()]
    .map(([label, ms]) => ({ label, value: +(ms / 3_600_000).toFixed(1) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const hours = +(totalMs / 3_600_000).toFixed(1);

  // ---- insights: plain-language, rule based
  const insights: string[] = [];
  const delta = doneInPeriod.length - donePrev.length;
  if (doneInPeriod.length === 0) insights.push(`No tasks completed in the last ${days} days yet.`);
  else
    insights.push(
      `You completed ${doneInPeriod.length} task${doneInPeriod.length === 1 ? "" : "s"} in the last ${days} days` +
        (delta > 0 && donePrev.length === 0 ? ", with nothing completed in the period before." : delta > 0 ? `, ${delta} more than the period before.` : delta < 0 ? `, ${-delta} fewer than the period before.` : ", the same as the period before."),
    );
  if (mix.urgent + mix.high > 0) insights.push(`${mix.urgent + mix.high} of them were high or urgent priority.`);
  if (withDue.length >= 3) insights.push(`${Math.round((onTime / withDue.length) * 100)}% of your completed tasks with a due date were on time.`);
  if (overdueOpen > 0) insights.push(`${overdueOpen} of your open tasks ${overdueOpen === 1 ? "is" : "are"} overdue. Worth clearing first.`);
  if (backlog[0] && backlog[0].ageDays > 30) insights.push(`Your oldest backlog item has waited ${backlog[0].ageDays} days: “${backlog[0].name}”.`);
  if (byProject[0] && hours > 0) insights.push(`You logged ${hours} h; most went to ${byProject[0].label}.`);
  if (current >= 3) insights.push(`${current}-day completion streak. Keep it going.`);

  return {
    days,
    generatedAt: new Date().toISOString(),
    user: { name: user.username, email: user.email, avatar: user.profilePicture ?? null },
    workspace: team.name,
    tree,
    totals: {
      assigned: tasks.length,
      open: open.length,
      done: done.length,
      completionRate: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
      overdueOpen,
      dueSoon,
    },
    stages: { backlog: backlogTasks.length, inProgress: open.length - backlogTasks.length, done: done.length },
    openByStatus,
    backlog,
    projectCount: allProjects.length,
    projects,
    impact: {
      completed: doneInPeriod.length,
      completedPrev: donePrev.length,
      points,
      priorityMix: mix,
      onTimeRate: withDue.length >= 3 ? Math.round((onTime / withDue.length) * 100) : null,
      medianCycleDays: cycle.length ? +median(cycle)!.toFixed(1) : null,
    },
    weekly,
    heat,
    streak: { current, best },
    effort: { tracked: entries.length > 0, hours, daily, byProject },
    insights: insights.slice(0, 5),
  };
}
