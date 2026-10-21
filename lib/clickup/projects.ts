import { loadHierarchy } from "./resolve";
import { engagedLists, myTasks } from "./me";
import { clickup } from "./client";
import { assignSlugs } from "../slug";

export type ProjectRef = { id: string; name: string; space: string; folder: string | null; slug: string };

// Every project I can reach (visible lists plus lists where I have tasks, even if archived),
// each with a stable URL slug. Pulse and the /{project} route both use this, so links always match.
export async function listAllProjects(): Promise<ProjectRef[]> {
  const [{ user }, { teams }] = await Promise.all([clickup<{ user: any }>("/user"), clickup<{ teams: any[] }>("/team")]);
  const team = teams[0];
  if (!team) return [];
  const [hierarchy, tasks] = await Promise.all([loadHierarchy(String(team.id)), myTasks(team.id, user.id)]);

  const all = new Map<string, Omit<ProjectRef, "slug">>();
  for (const h of hierarchy) {
    for (const l of h.folderless_lists) all.set(l.id, { id: l.id, name: l.name, space: h.space.name, folder: null });
    for (const f of h.folders) for (const l of f.lists) all.set(l.id, { id: l.id, name: l.name, space: h.space.name, folder: f.name });
  }
  for (const e of engagedLists(tasks).values()) {
    if (!all.has(e.id)) all.set(e.id, { id: e.id, name: e.name, space: e.folder ?? "Other", folder: null });
  }

  const slugs = assignSlugs([...all.values()]);
  return [...all.values()].map((p) => ({ ...p, slug: slugs.get(p.id)! }));
}

export async function findProjectBySlug(slug: string): Promise<ProjectRef | null> {
  const s = slug.toLowerCase();
  return (await listAllProjects()).find((p) => p.slug === s) ?? null;
}
