import { connection } from "next/server";
import { clickup } from "@/lib/clickup/client";
import { summarizeList, type Health } from "@/lib/clickup/data";
import { engagedLists, myTasks } from "@/lib/clickup/me";
import { listAllProjects } from "@/lib/clickup/projects";
import { authKey } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

export type Project = {
  id: string;
  name: string;
  space: string;
  total: number;
  done: number;
  overdue: number;
  progress: number; // 0-100
  health: Health;
  mine: boolean; // I have (or had) tasks assigned here
  myTasks: number;
  myDone: number;
  slug: string; // URL path: /{slug}
  // true = listed with its name and task count only (no live health yet; opens fully on click).
  partial?: boolean;
};

export type PulseData = {
  projects: Project[];
  counts: { mine: number; accessible: number };
  my: { open: number; overdue: number };
};

const OTHERS_SHOWN = 8; // besides my projects, this many of the busiest other lists get live health
const cache = new Map<string, { at: number; data: PulseData }>(); // one entry per signed-in person

// Reading many projects from ClickUp can take longer than a host's default function limit (e.g. Vercel's 10s).
export const maxDuration = 60;

async function handler() {
  await connection();
  const hit = cache.get(authKey());
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.data);

  try {
    const [{ user }, { teams }] = await Promise.all([clickup<{ user: any }>("/user"), clickup<{ teams: any[] }>("/team")]);
    const team = teams[0];
    if (!team) return Response.json({ projects: [], counts: { mine: 0, accessible: 0 }, my: { open: 0, overdue: 0 } } satisfies PulseData);

    const [tasks, { spaces }] = await Promise.all([
      myTasks(team.id, user.id),
      clickup<{ spaces: any[] }>(`/team/${team.id}/space`, { archived: false }),
    ]);

    // Everything I can see
    const accessible = new Map<string, { id: string; name: string; space: string; count: number }>();
    await Promise.all(
      spaces.map(async (s) => {
        const [{ folders }, { lists: loose }] = await Promise.all([
          clickup<{ folders: any[] }>(`/space/${s.id}/folder`, { archived: false }),
          clickup<{ lists: any[] }>(`/space/${s.id}/list`, { archived: false }),
        ]);
        for (const l of [...folders.flatMap((f) => f.lists), ...loose]) {
          accessible.set(l.id, { id: l.id, name: l.name, space: s.name, count: l.task_count ?? 0 });
        }
      }),
    );

    // Where I'm engaged (same definition the Me tab uses). Included even if the list is archived/hidden.
    const mine = engagedLists(tasks);
    const now = Date.now();
    const open = tasks.filter((t) => t.status?.type !== "closed" && t.status?.type !== "done");

    const others = [...accessible.values()]
      .filter((l) => !mine.has(l.id) && l.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, OTHERS_SHOWN);

    const targets = [
      ...[...mine.values()].map((m) => ({ id: m.id, name: m.name, space: accessible.get(m.id)?.space ?? m.folder ?? "", mine: m })),
      ...others.map((o) => ({ id: o.id, name: o.name, space: o.space, mine: undefined })),
    ];

    const slugOf = new Map((await listAllProjects()).map((p) => [p.id, p.slug]));

    const projects: Project[] = await Promise.all(
      targets.map(async (t) => {
        const s = await summarizeList(t.id, t.name);
        return {
          id: t.id,
          name: t.name,
          space: t.space,
          total: s.total,
          done: s.done,
          overdue: s.overdueCount,
          progress: s.progress,
          health: s.health,
          mine: !!t.mine,
          myTasks: t.mine?.assigned ?? 0,
          myDone: t.mine?.done ?? 0,
          slug: slugOf.get(t.id) ?? t.id,
        };
      }),
    );

    // Every other list I can access still appears (name + task count) so counts always add up.
    const detailed = new Set(targets.map((t) => t.id));
    const rest: Project[] = [...accessible.values()]
      .filter((l) => !detailed.has(l.id))
      .sort((a, b) => b.count - a.count)
      .map((l) => ({
        id: l.id,
        name: l.name,
        space: l.space,
        total: l.count,
        done: 0,
        overdue: 0,
        progress: 0,
        health: "on_track" as Health,
        mine: false,
        myTasks: 0,
        myDone: 0,
        slug: slugOf.get(l.id) ?? l.id,
        partial: true,
      }));

    const data: PulseData = {
      projects: [...projects, ...rest],
      counts: { mine: mine.size, accessible: new Set([...accessible.keys(), ...mine.keys()]).size },
      my: { open: open.length, overdue: open.filter((t) => t.due_date && Number(t.due_date) < now).length },
    };
    cache.set(authKey(), { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    reportError(e, "api/pulse");
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = withAuth(handler);
