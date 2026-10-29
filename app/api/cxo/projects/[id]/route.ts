import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { daysParam } from "@/lib/platform/params";
import { deleteProject, getProjectDef, ProjectInput, saveProject } from "@/lib/platform/projects";
import { loadDataset } from "@/lib/analytics/load";
import { projectReport } from "@/lib/analytics/projects";

type Ctx = { params: Promise<{ id: string }> };

// One project in depth: totals, layer/part/repo breakdowns and every contributor with their own split.
async function report(req: Request, { params }: Ctx) {
  await connection();
  const ws = activeWorkspaceId();
  const def = getProjectDef(ws, (await params).id);
  if (!def) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(projectReport(loadDataset(ws), def, Date.now(), daysParam(req)));
}

async function replace(req: Request, { params }: Ctx) {
  await connection();
  const parsed = ProjectInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid project" }, { status: 400 });
  try {
    return saveProject(activeWorkspaceId(), parsed.data, (await params).id) ? Response.json({ ok: true }) : Response.json({ error: "Project not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}

async function remove(_req: Request, { params }: Ctx) {
  await connection();
  return deleteProject(activeWorkspaceId(), (await params).id) ? Response.json({ ok: true }) : Response.json({ error: "Project not found" }, { status: 404 });
}

export const GET = withPlatform(report);
export const PUT = withPlatform(replace, { write: true });
export const DELETE = withPlatform(remove, { write: true });
