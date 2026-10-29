import { DAY, WEEK, type Dataset } from "./types";
import { median, round } from "./stats";
import type { ChangeKind } from "./changes";

// Project and repository views: "these 4 repos are one project; this person did this much on its frontend and backend".
// A project is a named group of repositories (each tagged with a LAYER such as frontend/backend and an optional PART such
// as admin/user) plus the task lists that belong to it. Everything here is plain counting over the dataset.
// Code is described by plain counts: commits (and how many only merge branches) and pull requests by state. Never lines.
export const LAYERS = ["frontend", "backend", "mobile", "infra", "other"] as const;
export type Layer = (typeof LAYERS)[number];

export type RepoRef = { repo: string; layer: Layer; part: string | null };
export type ProjectDef = { id: string; name: string; description?: string | null; repos: RepoRef[]; taskLists: string[] };

export type Work = { commits: number; merges: number; prsMerged: number; prsOpen: number };
const zero = (): Work => ({ commits: 0, merges: 0, prsMerged: 0, prsOpen: 0 });
const add = (w: Work, c: Partial<Work>) => {
  for (const k of Object.keys(c) as (keyof Work)[]) w[k] += c[k] ?? 0;
};
export const hasWork = (w: Work) => w.commits > 0 || w.prsMerged > 0 || w.prsOpen > 0;
const commitWork = (c: { kind: string }): Partial<Work> => ({ commits: 1, merges: c.kind === "merge" ? 1 : 0 });
const prWork = (): Partial<Work> => ({ prsMerged: 1 });

const windowOf = (now: number, days: number) => ({ from: days > 0 ? now - days * DAY : 0, to: now });

// ---- per repository -----------------------------------------------------------------------------------------------

export function repoActivity(ds: Dataset, now: number, days: number) {
  const { from, to } = windowOf(now, days);
  const names = new Map(ds.people.map((p) => [p.id, p.name]));
  const byRepo = new Map<string, { total: Work; people: Map<string, Work> }>();
  const slot = (repo: string, personId: string) => {
    const r = byRepo.get(repo) ?? { total: zero(), people: new Map<string, Work>() };
    byRepo.set(repo, r);
    const p = r.people.get(personId) ?? zero();
    r.people.set(personId, p);
    return { total: r.total, person: p };
  };
  for (const c of ds.commits) {
    if (c.at < from || c.at >= to) continue;
    const s = slot(c.repo, c.personId);
    add(s.total, commitWork(c));
    add(s.person, commitWork(c));
  }
  for (const p of ds.prs) {
    if (p.promotion) continue;
    const merged = p.mergedAt !== undefined && p.mergedAt >= from && p.mergedAt < to;
    const open = p.state === "open" && p.openedAt < to;
    if (!merged && !open) continue;
    const s = slot(p.repo, p.personId);
    const w: Partial<Work> = merged ? prWork() : { prsOpen: 1 };
    add(s.total, w);
    add(s.person, w);
  }
  return [...byRepo.entries()]
    .map(([repo, r]) => ({
      repo,
      ...r.total,
      contributors: [...r.people.entries()].map(([personId, work]) => ({ personId, name: names.get(personId) ?? "Unknown", work })).sort((a, b) => b.work.commits - a.work.commits),
    }))
    .sort((a, b) => b.commits - a.commits);
}

// ---- per project --------------------------------------------------------------------------------------------------

export type Breakdown = { key: string; repos: string[]; work: Work; contributors: number };
export type ListWork = { source: string; name: string; done: number; open: number };
export type PersonInProject = {
  personId: string;
  name: string;
  work: Work;
  kinds: Partial<Record<ChangeKind, number>>; // what their commits were: features, fixes, ...
  shareOfCommits: number; // 0..1 of the project's commits
  tasksDone: number;
  tasksOpen: number;
  byList: Record<string, ListWork>; // keyed "source::list name"
  byLayer: Record<string, Work>;
  byPart: Record<string, Work>;
  byRepo: { repo: string; layer: Layer; part: string | null; work: Work }[];
  prQuality: { reviewed: number; firstPass: number; medianHoursToMerge: number | null };
};

export type ProjectReport = {
  project: ProjectDef;
  days: number;
  totals: Work & { contributors: number; tasksDone: number; tasksOpen: number; tasksAssigned: number; reviewed: number; firstPass: number };
  layers: Breakdown[];
  parts: Breakdown[];
  repos: (RepoRef & { work: Work; contributors: number })[];
  lists: (ListWork & { people: number })[]; // the project's task lists, with which tool each came from
  statuses: { status: string; stage: string; count: number }[]; // where the project's tasks are, in the tool's own status names
  sources: string[]; // which task tools the project's tasks come from
  people: PersonInProject[];
  weekly: { weekStart: number; commits: number; tasksDone: number }[];
};

const STAGES = ["todo", "doing", "review", "done"];
export const listKey = (source: string | undefined, name: string) => `${source ?? "tasks"}::${name}`;

export function projectReport(ds: Dataset, project: ProjectDef, now: number, days: number): ProjectReport {
  const { from, to } = windowOf(now, days);
  const refOf = new Map(project.repos.map((r) => [r.repo.toLowerCase(), r]));
  const lists = new Set(project.taskLists.map((l) => l.toLowerCase()));
  const names = new Map(ds.people.map((p) => [p.id, p.name]));

  const people = new Map<string, PersonInProject>();
  const mergeHours = new Map<string, number[]>();
  const person = (id: string) => {
    let p = people.get(id);
    if (!p) people.set(id, (p = { personId: id, name: names.get(id) ?? "Unknown", work: zero(), kinds: {}, shareOfCommits: 0, tasksDone: 0, tasksOpen: 0, byList: {}, byLayer: {}, byPart: {}, byRepo: [], prQuality: { reviewed: 0, firstPass: 0, medianHoursToMerge: null } }));
    return p;
  };
  const repoWork = new Map<string, { work: Work; people: Set<string> }>();
  const layerWork = new Map<string, { work: Work; people: Set<string>; repos: Set<string> }>();
  const partWork = new Map<string, { work: Work; people: Set<string>; repos: Set<string> }>();

  const credit = (personId: string, ref: RepoRef, w: Partial<Work>) => {
    const p = person(personId);
    add(p.work, w);
    add((p.byLayer[ref.layer] ??= zero()), w);
    const partKey = ref.part ?? "(no part)";
    add((p.byPart[partKey] ??= zero()), w);
    let row = p.byRepo.find((r) => r.repo === ref.repo);
    if (!row) p.byRepo.push((row = { repo: ref.repo, layer: ref.layer, part: ref.part, work: zero() }));
    add(row.work, w);
    const rw = repoWork.get(ref.repo) ?? { work: zero(), people: new Set() };
    repoWork.set(ref.repo, rw);
    add(rw.work, w);
    rw.people.add(personId);
    for (const [map, key] of [[layerWork, ref.layer], [partWork, partKey]] as const) {
      const e = map.get(key) ?? { work: zero(), people: new Set(), repos: new Set() };
      map.set(key, e);
      add(e.work, w);
      e.people.add(personId);
      e.repos.add(ref.repo);
    }
  };

  const weeks = new Map<number, { commits: number; tasksDone: number }>();
  const week = (t: number) => {
    const k = Math.floor(t / WEEK) * WEEK;
    const w = weeks.get(k) ?? { commits: 0, tasksDone: 0 };
    weeks.set(k, w);
    return w;
  };

  for (const c of ds.commits) {
    const ref = refOf.get(c.repo.toLowerCase());
    if (!ref || c.at < from || c.at >= to) continue;
    credit(c.personId, ref, commitWork(c));
    const p = person(c.personId);
    p.kinds[c.kind] = (p.kinds[c.kind] ?? 0) + 1;
    week(c.at).commits++;
  }
  let reviewed = 0;
  let firstPass = 0;
  for (const p of ds.prs) {
    const ref = refOf.get(p.repo.toLowerCase());
    if (p.promotion || !ref) continue;
    if (p.state === "open" && p.openedAt < to) {
      credit(p.personId, ref, { prsOpen: 1 });
      continue;
    }
    if (p.mergedAt === undefined || p.mergedAt < from || p.mergedAt >= to) continue;
    credit(p.personId, ref, prWork());
    const q = person(p.personId).prQuality;
    if (p.reviewed) {
      q.reviewed++;
      reviewed++;
      if (p.reviewRounds === 0) {
        q.firstPass++;
        firstPass++;
      }
    }
    mergeHours.set(p.personId, [...(mergeHours.get(p.personId) ?? []), (p.mergedAt - p.openedAt) / 3_600_000]);
  }
  for (const [id, hrs] of mergeHours) {
    const m = median(hrs);
    person(id).prQuality.medianHoursToMerge = m === null ? null : round(m, 1);
  }

  let tasksDone = 0;
  let tasksOpen = 0;
  let tasksAssigned = 0;
  const listTotals = new Map<string, ListWork & { people: Set<string> }>();
  const statusCounts = new Map<string, { status: string; stage: string; count: number }>();
  for (const t of ds.tasks) {
    if (!lists.has(t.project.toLowerCase())) continue;
    if ((t.createdAt >= from && t.createdAt < to) || (t.doneAt !== undefined && t.doneAt >= from && t.doneAt < to) || t.doneAt === undefined) {
      const name = t.status || t.stage;
      const s = statusCounts.get(name) ?? { status: name, stage: t.stage, count: 0 };
      s.count++;
      statusCounts.set(name, s);
    }
    const key = listKey(t.source, t.project);
    const lt = listTotals.get(key) ?? { source: t.source ?? "tasks", name: t.project, done: 0, open: 0, people: new Set<string>() };
    listTotals.set(key, lt);
    const mine = (person(t.personId).byList[key] ??= { source: t.source ?? "tasks", name: t.project, done: 0, open: 0 });
    const done = t.doneAt !== undefined && t.doneAt >= from && t.doneAt < to;
    if (done) {
      person(t.personId).tasksDone++;
      mine.done++;
      lt.done++;
      lt.people.add(t.personId);
      tasksDone++;
      week(t.doneAt!).tasksDone++;
    }
    if (t.doneAt === undefined) {
      person(t.personId).tasksOpen++;
      mine.open++;
      lt.open++;
      lt.people.add(t.personId);
      tasksOpen++;
    }
    if (t.createdAt >= from && t.createdAt < to) tasksAssigned++;
  }

  const total = zero();
  for (const p of people.values()) add(total, p.work);
  for (const p of people.values()) p.shareOfCommits = total.commits ? p.work.commits / total.commits : 0;

  const toBreakdown = (m: Map<string, { work: Work; people: Set<string>; repos: Set<string> }>): Breakdown[] =>
    [...m.entries()].map(([key, e]) => ({ key, repos: [...e.repos].sort(), work: e.work, contributors: e.people.size })).sort((a, b) => b.work.commits - a.work.commits);

  const listRows = [...listTotals.values()].map(({ people: ppl, ...l }) => ({ ...l, people: ppl.size })).sort((a, b) => b.done + b.open - (a.done + a.open));
  return {
    project,
    days,
    totals: { ...total, contributors: [...people.values()].filter((p) => hasWork(p.work)).length, tasksDone, tasksOpen, tasksAssigned, reviewed, firstPass },
    layers: toBreakdown(layerWork),
    parts: toBreakdown(partWork),
    repos: project.repos.map((r) => ({ ...r, work: repoWork.get(r.repo)?.work ?? zero(), contributors: repoWork.get(r.repo)?.people.size ?? 0 })).sort((a, b) => b.work.commits - a.work.commits),
    lists: listRows,
    statuses: [...statusCounts.values()].sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || b.count - a.count),
    sources: [...new Set(listRows.map((l) => l.source))].sort(),
    people: [...people.values()].sort((a, b) => b.work.commits + b.work.prsMerged * 3 + b.tasksDone - (a.work.commits + a.work.prsMerged * 3 + a.tasksDone)),
    weekly: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([weekStart, w]) => ({ weekStart, ...w })),
  };
}

// One person across all projects: how much each project got from them, and where (layer, repo).
export function personProjectBreakdown(ds: Dataset, personId: string, projects: ProjectDef[], now: number, days: number) {
  const mine: Dataset = { ...ds, commits: ds.commits.filter((c) => c.personId === personId), prs: ds.prs.filter((p) => p.personId === personId), tasks: ds.tasks.filter((t) => t.personId === personId) };
  const rows = projects
    .map((p) => {
      const r = projectReport(mine, p, now, days);
      const me = r.people.find((x) => x.personId === personId);
      return { projectId: p.id, name: p.name, work: me?.work ?? zero(), kinds: me?.kinds ?? {}, tasksDone: me?.tasksDone ?? 0, tasksOpen: me?.tasksOpen ?? 0, byLayer: me?.byLayer ?? {}, byPart: me?.byPart ?? {}, byRepo: me?.byRepo ?? [], byList: me?.byList ?? {}, prQuality: me?.prQuality ?? { reviewed: 0, firstPass: 0, medianHoursToMerge: null } };
    })
    .filter((r) => hasWork(r.work) || r.tasksDone || r.tasksOpen)
    .sort((a, b) => b.work.commits + b.work.prsMerged * 3 + b.tasksDone - (a.work.commits + a.work.prsMerged * 3 + a.tasksDone));

  const mapped = new Set(projects.flatMap((p) => p.repos.map((r) => r.repo.toLowerCase())));
  const { from, to } = windowOf(now, days);
  const outside = zero();
  for (const c of mine.commits) if (c.at >= from && c.at < to && !mapped.has(c.repo.toLowerCase())) add(outside, commitWork(c));
  return { projects: rows, repos: repoActivity(mine, now, days).map((r) => ({ repo: r.repo, commits: r.commits, merges: r.merges, prsMerged: r.prsMerged, prsOpen: r.prsOpen })), notInAnyProject: outside };
}

// ---- suggestions: never applied automatically -----------------------------------------------------------------------

const LAYER_HINTS: [Layer, RegExp][] = [
  ["mobile", /(^|[-_.])(mobile|android|ios|flutter|react-?native|rn)([-_.]|$)/i],
  ["infra", /(^|[-_.])(infra|infrastructure|terraform|devops|deploy|cdk|k8s|helm|ci)([-_.]|$)/i],
  ["frontend", /(^|[-_.])(web|frontend|front-?end|fe|ui|client|portal|dashboard|site|react|next|vue|angular|app)([-_.]|$)/i],
  ["backend", /(^|[-_.])(api|backend|back-?end|be|server|service|services|core|worker|functions|lambda|graphql|db|database)([-_.]|$)/i],
];
const PART_HINT = /(^|[-_.])(admin|user|customer|public|partner|vendor|seller|driver|agent|staff|student|teacher|patient)s?([-_.]|$)/i;

export function suggestLayer(repo: string): Layer | null {
  const name = repo.split("/").pop() ?? repo;
  return LAYER_HINTS.find(([, re]) => re.test(name))?.[0] ?? null;
}
export const suggestPart = (repo: string): string | null => (repo.split("/").pop() ?? repo).match(PART_HINT)?.[2]?.toLowerCase() ?? null;

// Repos that share a name prefix ("shop-web", "shop-api", "shop-admin") probably belong to one project.
export function suggestProjects(repos: string[]): { name: string; repos: RepoRef[] }[] {
  const groups = new Map<string, string[]>();
  for (const r of repos) {
    const name = r.split("/").pop() ?? r;
    const prefix = name.toLowerCase().split(/[-_.]/)[0];
    if (prefix.length >= 3) groups.set(prefix, [...(groups.get(prefix) ?? []), r]);
  }
  return [...groups.entries()]
    .filter(([, rs]) => rs.length >= 2)
    .map(([prefix, rs]) => ({ name: prefix[0].toUpperCase() + prefix.slice(1), repos: rs.map((repo) => ({ repo, layer: suggestLayer(repo) ?? "other", part: suggestPart(repo) })) }));
}
