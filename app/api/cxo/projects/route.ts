import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { daysParam } from "@/lib/platform/params";
import { knownRepos, knownTaskLists, listProjectDefs, ProjectInput, saveProject } from "@/lib/platform/projects";
import { loadDataset } from "@/lib/analytics/load";
import { projectReport, suggestLayer, suggestPart, suggestProjects } from "@/lib/analytics/projects";

// Everything the Projects screen needs: each project with its headline numbers, every repo and task list that exists
// (and which project holds it), and suggested groupings for the repos nobody has assigned yet.
async function list(req: Request) {
  await connection();
  const ws = activeWorkspaceId();
  const days = daysParam(req);
  const ds = loadDataset(ws);
  const defs = listProjectDefs(ws);

  const projects = defs.map((p) => {
    const r = projectReport(ds, p, Date.now(), days);
    return { ...p, totals: r.totals, layers: r.layers.map((l) => ({ key: l.key, commits: l.work.commits })) };
  });

  const inProject = new Map<string, string[]>();
  for (const p of defs) for (const r of p.repos) inProject.set(r.repo.toLowerCase(), [...(inProject.get(r.repo.toLowerCase()) ?? []), p.name]);
  const listIn = new Map<string, string[]>();
  for (const p of defs) for (const l of p.taskLists) listIn.set(l.toLowerCase(), [...(listIn.get(l.toLowerCase()) ?? []), p.name]);

  const repos = knownRepos(ws).map((r) => ({ ...r, projects: inProject.get(r.repo.toLowerCase()) ?? [], suggestedLayer: suggestLayer(r.repo), suggestedPart: suggestPart(r.repo) }));
  const taskLists = knownTaskLists(ws).map((l) => ({ ...l, projects: listIn.get(l.name.toLowerCase()) ?? [] }));
  return Response.json({ days, projects, repos, taskLists, suggestions: suggestProjects(repos.filter((r) => r.projects.length === 0).map((r) => r.repo)) });
}

async function create(req: Request) {
  await connection();
  const parsed = ProjectInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid project" }, { status: 400 });
  try {
    const id = saveProject(activeWorkspaceId(), parsed.data);
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}

export const GET = withPlatform(list);
export const POST = withPlatform(create, { write: true });
