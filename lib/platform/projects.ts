import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, tx } from "../db";
import { LAYERS, type ProjectDef } from "../analytics/projects";

// Projects as the CXO defines them: a name plus the repositories (each tagged with a layer and optional part) and the
// task lists that belong to it. Every query is scoped to one workspace.
const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name");
export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(80),
  description: z.string().trim().max(300).nullish(),
  repos: z.array(z.object({ repo: repoName, layer: z.enum(LAYERS), part: z.string().trim().max(30).regex(/^[\w -]+$/).nullish().transform((v) => v || null) })).max(60).default([]),
  taskLists: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export function listProjectDefs(workspaceId: string): ProjectDef[] {
  const d = db();
  const projects = d.prepare("SELECT id, name, description FROM projects WHERE workspace_id = ? ORDER BY name COLLATE NOCASE").all(workspaceId) as { id: string; name: string; description: string | null }[];
  const sources = d.prepare("SELECT project_id, kind, ref, layer, part FROM project_sources WHERE workspace_id = ? ORDER BY ref COLLATE NOCASE").all(workspaceId) as { project_id: string; kind: string; ref: string; layer: string | null; part: string | null }[];
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    repos: sources.filter((s) => s.project_id === p.id && s.kind === "repo").map((s) => ({ repo: s.ref, layer: (s.layer ?? "other") as ProjectDef["repos"][number]["layer"], part: s.part })),
    taskLists: sources.filter((s) => s.project_id === p.id && s.kind === "tasks").map((s) => s.ref),
  }));
}

export const getProjectDef = (workspaceId: string, id: string) => listProjectDefs(workspaceId).find((p) => p.id === id) ?? null;

// Creates (no id) or replaces (id) a project and ALL its sources in one go.
export function saveProject(workspaceId: string, input: ProjectInput, id?: string): string | null {
  const d = db();
  return tx(() => {
    if (id && !d.prepare("SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?").get(id, workspaceId)) return null;
    const clash = d.prepare("SELECT id FROM projects WHERE workspace_id = ? AND lower(name) = lower(?)").get(workspaceId, input.name) as { id: string } | undefined;
    if (clash && clash.id !== id) throw new Error(`A project called "${input.name}" already exists.`);
    const pid = id ?? randomUUID();
    if (id) d.prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?").run(input.name, input.description ?? null, id);
    else d.prepare("INSERT INTO projects (id, workspace_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)").run(pid, workspaceId, input.name, input.description ?? null, Date.now());
    d.prepare("DELETE FROM project_sources WHERE project_id = ?").run(pid);
    const ins = d.prepare("INSERT OR IGNORE INTO project_sources (id, project_id, workspace_id, kind, ref, layer, part) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const r of input.repos) ins.run(randomUUID(), pid, workspaceId, "repo", r.repo, r.layer, r.part);
    for (const l of input.taskLists) ins.run(randomUUID(), pid, workspaceId, "tasks", l, null, null);
    return pid;
  });
}

export const deleteProject = (workspaceId: string, id: string) => db().prepare("DELETE FROM projects WHERE id = ? AND workspace_id = ?").run(id, workspaceId).changes > 0;

// What exists in the synced data, so the CXO can pick from real names instead of typing them.
export function knownRepos(workspaceId: string) {
  return db()
    .prepare(
      `SELECT repo, SUM(commits) AS commits, SUM(prs) AS prs FROM (
         SELECT repo, COUNT(*) AS commits, 0 AS prs FROM commits WHERE workspace_id = ? GROUP BY repo
         UNION ALL
         SELECT repo, 0, COUNT(*) FROM pull_requests WHERE workspace_id = ? GROUP BY repo
       ) GROUP BY repo ORDER BY commits DESC, repo`,
    )
    .all(workspaceId, workspaceId) as { repo: string; commits: number; prs: number }[];
}

export function knownTaskLists(workspaceId: string) {
  return db()
    .prepare("SELECT project AS name, source, COUNT(DISTINCT external_id) AS tasks FROM tasks WHERE workspace_id = ? GROUP BY project, source ORDER BY tasks DESC, project")
    .all(workspaceId) as { name: string; source: string; tasks: number }[];
}
