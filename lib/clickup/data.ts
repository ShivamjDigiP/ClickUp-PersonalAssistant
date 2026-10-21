import { clickup } from "./client";

// Shared read helpers used by tools, the Pulse view, project pages and charts,
// so every screen reports the same numbers.
export const ms = (v?: string | null) => (v ? new Date(Number(v)).toISOString().slice(0, 10) : null);

export function slimTask(t: any) {
  return {
    id: t.id,
    name: t.name,
    list_id: t.list?.id,
    status: t.status?.status,
    assignees: (t.assignees ?? []).map((a: any) => a.username),
    due: ms(t.due_date),
    updated: ms(t.date_updated),
    priority: t.priority?.priority ?? null,
    list: t.list?.name,
    url: t.url,
  };
}
export type SlimTask = ReturnType<typeof slimTask>;

export async function fetchListTasks(listId: string, maxPages = 5) {
  const out: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await clickup<{ tasks: any[]; last_page?: boolean }>(`/list/${listId}/task`, {
      page,
      include_closed: true,
      subtasks: true,
    });
    out.push(...data.tasks);
    if (data.last_page || data.tasks.length === 0) break;
  }
  return out;
}

export type Health = "on_track" | "at_risk" | "behind";

// Health is computed from data, not guessed: share of open tasks past their due date.
export function healthOf(open: number, overdue: number): Health {
  if (open === 0 || overdue === 0) return "on_track";
  return overdue / open < 0.3 ? "at_risk" : "behind";
}

export type ListSummary = {
  id: string;
  name: string;
  total: number;
  done: number;
  overdueCount: number;
  progress: number; // 0-100
  health: Health;
  byStatus: Record<string, number>;
  byAssignee: Record<string, number>; // open tasks per person
  overdue: SlimTask[];
  dueSoon: SlimTask[];
  stale: SlimTask[];
};

export const assignedTo = (t: any, userId: string) => (t.assignees ?? []).some((a: any) => String(a.id) === String(userId));

// assigneeId limits the numbers to one person's tasks; omit it for the whole list.
export async function summarizeList(listId: string, fallbackName = "List", assigneeId?: string | null): Promise<ListSummary> {
  const all = await fetchListTasks(listId);
  const tasks = assigneeId ? all.filter((t) => assignedTo(t, assigneeId)) : all;
  const now = Date.now();
  const day = 86_400_000;
  const byStatus: Record<string, number> = {};
  const byAssignee: Record<string, number> = {};
  const overdue: SlimTask[] = [];
  const dueSoon: SlimTask[] = [];
  const stale: SlimTask[] = [];
  let done = 0;
  let open = 0;

  for (const t of tasks) {
    const status = t.status?.status ?? "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (t.status?.type === "closed" || t.status?.type === "done") {
      done++;
      continue;
    }
    open++;
    for (const a of t.assignees ?? []) byAssignee[a.username] = (byAssignee[a.username] ?? 0) + 1;
    const due = t.due_date ? Number(t.due_date) : null;
    if (due && due < now) overdue.push(slimTask(t));
    else if (due && due < now + 7 * day) dueSoon.push(slimTask(t));
    if (now - Number(t.date_updated) > 7 * day) stale.push(slimTask(t));
  }

  return {
    id: listId,
    name: tasks[0]?.list?.name ?? fallbackName,
    total: tasks.length,
    done,
    overdueCount: overdue.length,
    progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    health: healthOf(open, overdue.length),
    byStatus,
    byAssignee,
    overdue,
    dueSoon,
    stale,
  };
}
