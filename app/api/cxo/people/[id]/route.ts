import { connection } from "next/server";
import { z } from "zod";
import { withPlatform } from "@/lib/platform/guard";
import { db } from "@/lib/db";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { loadDataset } from "@/lib/analytics/load";
import { analyzeTeam } from "@/lib/analytics/capability";
import { personForecast } from "@/lib/analytics/overview";
import { personProjectBreakdown, type Work } from "@/lib/analytics/projects";
import { personWork } from "@/lib/analytics/personWork";
import { listProjectDefs } from "@/lib/platform/projects";
import { daysParam } from "@/lib/platform/params";
import { ALL_DAYS } from "@/lib/analytics/types";

type Ctx = { params: Promise<{ id: string }> };

// One developer in depth: their card, the forecast for their open work, daily activity for the heatmap.
async function detail(req: Request, { params }: Ctx) {
  await connection();
  const { id } = await params;
  const now = Date.now();
  // the headline numbers use 7/30/90 days; the work breakdown can also cover a year or everything on record
  const range = daysParam(req);
  const days = range === 0 ? ALL_DAYS : range === 7 || range === 30 ? range : 90;
  const ws = activeWorkspaceId();
  const ds = loadDataset(ws);
  const card = analyzeTeam(ds, now, days).find((c) => c.person.id === id);
  if (!card) return Response.json({ error: "Person not found" }, { status: 404 });

  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const activity = new Map<string, { commits: number; completed: number }>();
  const bump = (ms: number, k: "commits" | "completed") => {
    const e = activity.get(day(ms)) ?? { commits: 0, completed: 0 };
    e[k]++;
    activity.set(day(ms), e);
  };
  ds.commits.filter((c) => c.personId === id && c.at >= now - 120 * 86_400_000).forEach((c) => bump(c.at, "commits"));
  ds.tasks.filter((t) => t.personId === id && t.doneAt && t.doneAt >= now - 120 * 86_400_000).forEach((t) => bump(t.doneAt!, "completed"));

  const breakdown = personProjectBreakdown(ds, id, listProjectDefs(ws), now, range);
  const layers: Record<string, Work> = {};
  for (const p of breakdown.projects)
    for (const [layer, w] of Object.entries(p.byLayer)) {
      const t = (layers[layer] ??= { commits: 0, merges: 0, prsMerged: 0, prsOpen: 0 });
      for (const k of Object.keys(t) as (keyof Work)[]) t[k] += w[k];
    }

  return Response.json({
    card,
    forecast: personForecast(ds, id, now),
    range,
    breakdown: { ...breakdown, layers },
    activity: [...activity.entries()].sort().map(([date, v]) => ({ date, ...v })),
    // every task and every commit / pull request, counted and linked, for the same period as the rest of the page
    work: personWork(ds, id, listProjectDefs(ws), now, range),
  });
}

// The CXO tells us what the tools cannot: what the person does (role) and their designation. The start is read from the data.
const Patch = z.object({ level: z.enum(["junior", "mid", "senior"]).optional(), role: z.enum(["developer", "designer", "client_success", "manager"]).nullable().optional(), active: z.boolean().optional() });

async function update(req: Request, { params }: Ctx) {
  await connection();
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return Response.json({ error: "Nothing valid to update" }, { status: 400 });
  const p = parsed.data;
  const res = db()
    .prepare("UPDATE people SET level = COALESCE(?, level), role = CASE WHEN ? = 1 THEN ? ELSE role END, active = COALESCE(?, active) WHERE id = ? AND workspace_id = ?")
    .run(p.level ?? null, p.role !== undefined ? 1 : 0, p.role ?? null, p.active === undefined ? null : p.active ? 1 : 0, (await params).id, activeWorkspaceId());
  return res.changes ? Response.json({ ok: true }) : Response.json({ error: "Person not found" }, { status: 404 });
}

export const GET = withPlatform(detail);
export const PATCH = withPlatform(update, { write: true });
