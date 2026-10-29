import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { daysParam } from "@/lib/platform/params";
import { listProjectDefs } from "@/lib/platform/projects";
import { loadDataset } from "@/lib/analytics/load";
import { repoActivity } from "@/lib/analytics/projects";

// Repository-wise commits, lines and PRs, with who contributed, and which project each repo belongs to.
async function repos(req: Request) {
  await connection();
  const ws = activeWorkspaceId();
  const days = daysParam(req);
  const defs = listProjectDefs(ws);
  const where = new Map<string, { project: string; layer: string; part: string | null }[]>();
  for (const p of defs) for (const r of p.repos) where.set(r.repo.toLowerCase(), [...(where.get(r.repo.toLowerCase()) ?? []), { project: p.name, layer: r.layer, part: r.part }]);
  const rows = repoActivity(loadDataset(ws), Date.now(), days).map((r) => ({ ...r, projects: where.get(r.repo.toLowerCase()) ?? [] }));
  return Response.json({ days, repos: rows });
}

export const GET = withPlatform(repos);
