import { clickup } from "./client";

// Lets tools accept a name ("Imported from Jira") or an id, so the LLM never has to ask the user for ids.
export type Hierarchy = {
  space: { id: string; name: string };
  folders: { id: string; name: string; lists: { id: string; name: string; task_count?: number }[] }[];
  folderless_lists: { id: string; name: string; task_count?: number }[];
}[];

const TTL = 60_000;
const cache = new Map<string, { at: number; data: Hierarchy }>();

export async function defaultTeamId(teamId?: string) {
  if (teamId) return String(teamId);
  const { teams } = await clickup<{ teams: any[] }>("/team");
  if (!teams[0]) throw new Error("No ClickUp workspace found for this token");
  return String(teams[0].id);
}

export async function loadHierarchy(teamId?: string): Promise<Hierarchy> {
  const team = await defaultTeamId(teamId);
  const hit = cache.get(team);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const { spaces } = await clickup<{ spaces: any[] }>(`/team/${team}/space`, { archived: false });
  const slim = (l: any) => ({ id: String(l.id), name: l.name, task_count: l.task_count });
  const data: Hierarchy = await Promise.all(
    spaces.map(async (s) => {
      const [{ folders }, { lists }] = await Promise.all([
        clickup<{ folders: any[] }>(`/space/${s.id}/folder`, { archived: false }),
        clickup<{ lists: any[] }>(`/space/${s.id}/list`, { archived: false }),
      ]);
      return {
        space: { id: String(s.id), name: s.name },
        folders: folders.map((f) => ({ id: String(f.id), name: f.name, lists: f.lists.map(slim) })),
        folderless_lists: lists.map(slim),
      };
    }),
  );
  cache.set(team, { at: Date.now(), data });
  return data;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type ResolvedList = { id: string; name: string; path: string };

// Accepts a list/folder/space id or name. Folder/space names expand to all their lists.
export async function resolveLists(query: string, teamId?: string): Promise<ResolvedList[]> {
  const h = await loadHierarchy(teamId);
  const q = norm(String(query ?? ""));
  if (!q) throw new Error("No list given. Call get_hierarchy to see the available lists.");

  type Cand = { rank: number; lists: ResolvedList[] };
  const cands: Cand[] = [];
  const consider = (label: string, id: string, rank: number, lists: ResolvedList[]) => {
    const n = norm(label);
    if (String(query).trim() === id) cands.push({ rank: 0, lists });
    else if (n === q) cands.push({ rank, lists });
    else if (n && (n.includes(q) || q.includes(n))) cands.push({ rank: rank + 3, lists });
  };

  for (const { space, folders, folderless_lists } of h) {
    const inSpace: ResolvedList[] = [];
    for (const l of folderless_lists) {
      const r = { id: l.id, name: l.name, path: space.name };
      inSpace.push(r);
      consider(l.name, l.id, 1, [r]);
    }
    for (const f of folders) {
      const inFolder = f.lists.map((l) => ({ id: l.id, name: l.name, path: `${space.name} / ${f.name}` }));
      inSpace.push(...inFolder);
      inFolder.forEach((r) => consider(r.name, r.id, 1, [r]));
      consider(f.name, f.id, 2, inFolder);
    }
    consider(space.name, space.id, 3, inSpace);
  }

  if (!cands.length) {
    const names = h.flatMap((x) => [x.space.name, ...x.folders.map((f) => f.name), ...x.folderless_lists.map((l) => l.name)]);
    throw new Error(`Nothing named "${query}". Available: ${names.slice(0, 40).join("; ")}`);
  }
  const best = Math.min(...cands.map((c) => c.rank));
  const seen = new Map<string, ResolvedList>();
  for (const c of cands.filter((c) => c.rank === best)) for (const l of c.lists) seen.set(l.id, l);
  return [...seen.values()].slice(0, 10);
}

// Who a question is about. Default is the current user; "team"/"all" means everyone; otherwise a member's name.
export type Scope = { id: string | null; label: string };
let me: { id: string; name: string } | null = null;

export async function currentUser() {
  if (me) return me;
  const { user } = await clickup<{ user: any }>("/user");
  return (me = { id: String(user.id), name: String(user.username ?? "you") });
}

export async function resolveScope(scope?: string, teamId?: string): Promise<Scope> {
  const q = norm(String(scope ?? ""));
  if (!q || ["me", "my", "mine", "myself"].includes(q)) {
    const u = await currentUser();
    return { id: u.id, label: `${u.name} (you)` };
  }
  if (["team", "all", "everyone", "everybody", "workspace", "global", "whole team"].includes(q)) return { id: null, label: "whole team" };

  const id = await defaultTeamId(teamId);
  const { teams } = await clickup<{ teams: any[] }>("/team");
  const members = (teams.find((t) => String(t.id) === id)?.members ?? []).map((m: any) => m.user);
  const hit = members.filter((u: any) => [u.username, u.email].some((v) => v && norm(String(v)).includes(q)));
  if (hit.length === 1) return { id: String(hit[0].id), label: hit[0].username };
  if (hit.length > 1) throw new Error(`"${scope}" matches several people: ${hit.map((u: any) => u.username).join(", ")}. Use the full name.`);
  throw new Error(`No team member matches "${scope}". Members: ${members.map((u: any) => u.username).join(", ")}`);
}
