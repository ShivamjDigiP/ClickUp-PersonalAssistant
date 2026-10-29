import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { requirePlatform } from "@/lib/platform/context";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { db } from "@/lib/db";
import { limit } from "@/lib/ratelimit";
import { isLocalRequest } from "@/lib/connections/local";
import { loadDataset } from "@/lib/analytics/load";
import { analyzeTeam } from "@/lib/analytics/capability";
import { buildInsightInput, generateInsight, type Insight, type InsightCache } from "@/lib/analytics/insights";
import { personWork } from "@/lib/analytics/personWork";
import { listProjectDefs } from "@/lib/platform/projects";
import { ALL_DAYS } from "@/lib/analytics/types";

export const maxDuration = 60;

// An AI-written summary of one developer, from numbers the engine already computed. Cached by a hash of those numbers,
// so asking again without new data costs nothing; a summary with a number the model invented is never shown.
async function insight(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const me = requirePlatform();
  const ws = activeWorkspaceId();
  const gate = await limit(`cxo-insight/${me.userId}`, 40, 3600);
  if (!gate.ok) return Response.json({ error: "Too many summaries requested. Try again in a while." }, { status: 429 });

  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = raw === 0 ? ALL_DAYS : raw === 7 || raw === 30 ? raw : 90;
  const now = Date.now();
  const ds = loadDataset(ws);
  const { id } = await params;
  const found = analyzeTeam(ds, now, days).find((c) => c.person.id === id);
  if (!found) return Response.json({ error: "Person not found" }, { status: 404 });

  const cache: InsightCache = {
    async get(hash) {
      const r = db().prepare("SELECT output_json FROM ai_insights WHERE hash = ? AND workspace_id = ?").get(hash, ws) as { output_json: string } | undefined;
      return r ? (JSON.parse(r.output_json) as Insight) : null;
    },
    async set(hash, value) {
      db().prepare("INSERT OR REPLACE INTO ai_insights (hash, workspace_id, person_id, output_json, created_at) VALUES (?, ?, ?, ?, ?)").run(hash, ws, id, JSON.stringify(value), Date.now());
    },
  };
  const w = personWork(ds, id, listProjectDefs(ws), now, days).tasks;
  const input = buildInsightInput(found, ds.people.length, now, { finished: w.finished, fromImport: w.notCounted, open: w.open });
  const result = await generateInsight(input, { local: isLocalRequest(req), cache });
  return Response.json(result);
}

export const POST = withPlatform(insight);
