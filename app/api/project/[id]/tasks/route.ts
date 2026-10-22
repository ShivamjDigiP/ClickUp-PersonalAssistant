import { connection } from "next/server";
import { clickup } from "@/lib/clickup/client";
import { fetchListTasks } from "@/lib/clickup/data";
import { isBacklog, isDone } from "@/lib/clickup/me";
import { listAllProjects } from "@/lib/clickup/projects";
import type { PTask, Priority, Stage } from "@/lib/projectFilters";
import { authKey } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

export type ProjectTasks = {
  project: { id: string; name: string; space: string; folder: string | null; slug: string };
  statuses: { status: string; type: string; color: string | null }[];
  tasks: PTask[];
  truncated: boolean; // more tasks exist than were loaded
};

const MAX_PAGES = 10; // up to 1000 tasks
const cache = new Map<string, { at: number; data: ProjectTasks }>();

// Read-only: every task of one project, slimmed down so the browser can filter and chart it instantly.
export const maxDuration = 60; // big projects load up to 1000 tasks

async function handler(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const ck = `${authKey()}:${id}`; // per person: what you may see in a list depends on your permissions
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 30_000) return Response.json(hit.data);

  try {
    const [list, raw, projects] = await Promise.all([
      clickup<{ name: string; statuses?: any[] }>(`/list/${id}`),
      fetchListTasks(id, MAX_PAGES),
      listAllProjects().catch(() => []),
    ]);
    const ref = projects.find((p) => p.id === id);

    const tasks: PTask[] = raw.map((t) => {
      const stage: Stage = isDone(t) ? "done" : isBacklog(t) ? "backlog" : "progress";
      const p = t.priority?.priority as Priority | undefined;
      return {
        id: t.id,
        name: t.name,
        url: t.url,
        status: t.status?.status ?? "unknown",
        stage,
        assignees: (t.assignees ?? []).map((a: any) => ({ id: a.id, name: a.username ?? a.email ?? `User ${a.id}` })),
        priority: p && ["urgent", "high", "normal", "low"].includes(p) ? p : "none",
        due: t.due_date ? Number(t.due_date) : null,
        created: Number(t.date_created),
        updated: Number(t.date_updated),
        closed: t.date_closed ? Number(t.date_closed) : null,
      };
    });

    const data: ProjectTasks = {
      project: {
        id,
        name: list.name,
        space: ref?.space ?? "Other",
        folder: ref?.folder ?? null,
        slug: ref?.slug ?? id,
      },
      statuses: (list.statuses ?? []).map((s) => ({ status: s.status, type: s.type, color: s.color ?? null })),
      tasks,
      truncated: raw.length >= MAX_PAGES * 100,
    };
    cache.set(ck, { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    reportError(e, "api/project/tasks");
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = withAuth(handler);
