import { HttpError, httpJson, limiter } from "./http";
import { emptyBatch, priorityOf, stageOfStatus, type Adapter, type ClickUpConfig, type NormTask, type PersonHint } from "./types";

// ClickUp for the CXO platform: every member's tasks across one workspace, with the token that workspace was connected with.
// (This is separate from lib/clickup/client.ts, which acts as the signed-in person for the personal assistant.)
const BASE = "https://api.clickup.com/api/v2";
const call = limiter(5);
const get = <T,>(secret: string, path: string, params: Record<string, string | number | boolean | string[]> = {}) => {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) (Array.isArray(v) ? v : [v]).forEach((x) => url.searchParams.append(k, String(x)));
  return call(() => httpJson<T>(url, { label: "ClickUp", headers: { Authorization: secret } }));
};

type Member = { user: { id: number; username?: string; email?: string } };
const toHint = (u: { id: number | string; username?: string; email?: string }): PersonHint => ({
  provider: "clickup",
  externalId: String(u.id),
  name: u.username || undefined,
  email: u.email?.toLowerCase() || undefined,
});

async function pickTeam(secret: string, teamId?: string) {
  const { teams } = await get<{ teams: { id: string; name: string; members?: Member[] }[] }>(secret, "/team");
  const team = teamId ? teams.find((t) => String(t.id) === String(teamId)) : teams[0];
  if (!team) throw new Error(teamId ? `No ClickUp workspace with id ${teamId} is visible to this token` : "This token can see no ClickUp workspace");
  return team;
}

const MAX_PAGES = 30; // 100 tasks each
async function fetchTasks(secret: string, teamId: string, params: Record<string, string | number | boolean>) {
  const out: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await get<{ tasks: any[]; last_page?: boolean }>(secret, `/team/${teamId}/task`, { ...params, page, subtasks: true });
    out.push(...data.tasks);
    if (data.last_page || data.tasks.length < 100) break;
  }
  return out;
}

// ClickUp only records WHEN a task entered each status in "time in status" (needs the Total time in Status ClickApp).
// The first time it entered a working status is when work started; that is what makes cycle time honest.
const WORKING = /develop|progress|doing|wip|coding|review|qa\b|testing/i;
async function startTimes(secret: string, ids: string[], notes: string[]): Promise<Map<string, number>> {
  const started = new Map<string, number>();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const res = await get<Record<string, { status_history?: { status: string; total_time?: { since?: string } }[] }>>(secret, "/task/bulk_time_in_status/task_ids", { task_ids: batch });
      for (const [id, v] of Object.entries(res)) {
        const times = (v.status_history ?? []).filter((h) => WORKING.test(h.status)).map((h) => Number(h.total_time?.since)).filter((n) => n > 0);
        if (times.length) started.set(id, Math.min(...times));
      }
    }
    // ClickUp answers 200 with nothing at all on plans without Time In Status, so an empty result is the signal
    if (ids.length > 0 && started.size === 0) notes.push("ClickUp gave no start times (Time In Status is not available on this ClickUp plan). Speed from start to done is left out of the score instead of being guessed.");
  } catch (e) {
    notes.push(`ClickUp start times unavailable (${(e as Error).message.slice(0, 120)}). Cycle time is left out rather than guessed; enable the "Total time in Status" ClickApp to get it.`);
  }
  return started;
}

export const clickupAdapter: Adapter<ClickUpConfig> = {
  provider: "clickup",

  async validate(config, secret) {
    try {
      const { user } = await get<{ user: { username?: string; email?: string } }>(secret, "/user");
      const team = await pickTeam(secret, config.teamId);
      return { ok: true, account: `${user.username ?? user.email ?? "ClickUp user"} · workspace ${team.name}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async sync(config, secret, { since, now }) {
    const batch = emptyBatch();
    const team = await pickTeam(secret, config.teamId);
    batch.people = (team.members ?? []).map((m) => toHint(m.user));

    // Tasks touched since the last sync, plus every task that is still open (old open work still counts as workload)
    const [recent, open] = await Promise.all([
      fetchTasks(secret, team.id, { include_closed: true, date_updated_gt: since }),
      fetchTasks(secret, team.id, { include_closed: false }),
    ]);
    const byId = new Map<string, any>();
    for (const t of [...open, ...recent]) byId.set(t.id, t);

    const isDone = (t: any) => t.status?.type === "closed" || t.status?.type === "done";
    const finished = [...byId.values()].filter(isDone).sort((a, b) => Number(b.date_updated) - Number(a.date_updated)).slice(0, 300);
    const started = await startTimes(secret, finished.map((t) => t.id), batch.notes);

    for (const t of byId.values()) {
      const done = isDone(t);
      const status = String(t.status?.status ?? "");
      for (const a of t.assignees ?? []) {
        const task: NormTask = {
          source: "clickup",
          externalId: String(t.id),
          assignee: toHint(a),
          project: String(t.list?.name ?? t.folder?.name ?? "No list"),
          title: String(t.name ?? "(untitled)"),
          priority: priorityOf(t.priority?.priority),
          stage: stageOfStatus(status, done),
          status,
          parent: t.parent ? String(t.parent) : undefined,
          createdAt: Number(t.date_created),
          startedAt: started.get(t.id),
          doneAt: done ? Number(t.date_done ?? t.date_closed ?? t.date_updated) || undefined : undefined,
          dueAt: t.due_date ? Number(t.due_date) : undefined,
          reopened: undefined, // ClickUp does not expose reopen counts: unknown, not zero
          url: t.url,
          updatedAt: Number(t.date_updated) || now,
        };
        batch.tasks.push(task);
      }
    }
    return batch;
  },
};

export { HttpError };
