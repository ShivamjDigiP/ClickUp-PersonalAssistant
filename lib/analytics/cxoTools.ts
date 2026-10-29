import type { Tool } from "../clickup/tools";
import type { Chart } from "../charts";
import { listProjectDefs } from "../platform/projects";
import { analyzeTeam } from "./capability";
import { loadDataset, unlinkedAccounts } from "./load";
import { buildOverview, personForecast } from "./overview";
import { personWork } from "./personWork";
import { personProjectBreakdown, projectReport, repoActivity, type Work } from "./projects";
import { ALL_DAYS, LEVEL_LABEL, ROLE_LABEL, type Dataset, type Role } from "./types";

// What the CXO chat can look at. Every tool is read-only and works on ONE workspace (the signed-in person's), and every
// number comes from the same functions the dashboards use, so the chat and the screens always agree.
const pct = (n: number | null) => (n === null ? null : Math.round(n * 100));
// Code is described by what was done and how far it reached, never by lines of code (they do not measure work).
const work = (w: Work) => ({ commits: w.commits, mergeCommits: w.merges, prsMerged: w.prsMerged, prsOpen: w.prsOpen });
const roleOf = (r: unknown): Role | undefined => (r === "developer" || r === "designer" || r === "client_success" || r === "manager" ? r : undefined);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const scoreDays = (n: unknown): number => (n === 0 ? ALL_DAYS : n === 7 || n === 30 || n === 90 ? n : n === 365 ? 365 : 30);
const range = (n: unknown) => (typeof n === "number" && [0, 7, 30, 90, 365].includes(n) ? n : 30);

export function findPerson(ds: Dataset, query: string) {
  const q = norm(String(query ?? ""));
  const exact = ds.people.filter((p) => norm(p.name) === q);
  const hits = exact.length ? exact : ds.people.filter((p) => q && (norm(p.name).includes(q) || q.includes(norm(p.name))));
  if (hits.length === 1) return hits[0];
  const names = ds.people.map((p) => p.name).slice(0, 40).join(", ");
  throw new Error(hits.length ? `"${query}" matches several people: ${hits.map((p) => p.name).join(", ")}. Use the full name.` : `No one called "${query}". People: ${names}`);
}

function findProject(workspaceId: string, query: string) {
  const defs = listProjectDefs(workspaceId);
  const q = norm(String(query ?? ""));
  const hit = defs.find((d) => norm(d.name) === q) ?? defs.find((d) => q && norm(d.name).includes(q));
  if (!hit) throw new Error(defs.length ? `No project called "${query}". Projects: ${defs.map((d) => d.name).join(", ")}` : "No projects are set up yet. Group repositories into projects on the Projects screen.");
  return hit;
}

export function cxoTools(workspaceId: string, now = Date.now()): { tools: Tool[]; charts: Chart[] } {
  const charts: Chart[] = [];
  const addChart = (c: Chart) => charts.length < 3 && c.data.length > 0 && charts.push(c);
  let cache: Dataset | null = null;
  const ds = () => (cache ??= loadDataset(workspaceId));
  const days = { type: "number", description: "Period in days: 30, or 0 for all time (default 30). Use the period the user chose." };

  const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: (a: any) => unknown): Tool => ({
    name,
    kind: "read",
    description,
    parameters: { type: "object", properties, required },
    run: async (a) => run(a ?? {}),
  });

  const tools: Tool[] = [
    tool(
      "get_team_overview",
      "Team-wide picture for a period: tasks assigned/completed, on-time rate, commits, PRs, per-person facts (tasks finished, commits, pull requests merged), plain counts of what is going on, and the things worth looking at. There is no score or ranking: never grade or rank people.",
      { days, role: { type: "string", description: "Only this role: developer, designer, client_success or manager. Use it when the question is about one kind of person (for example \"developers\"). Leave out for everyone." } },
      [],
      (a) => {
        const o = buildOverview(ds(), now, scoreDays(a.days), roleOf(a.role));
        addChart({ kind: "bars", title: "Most commits", data: [...o.cards].sort((x, y) => y.metrics.current.commits - x.metrics.current.commits).slice(0, 6).map((c) => ({ label: c.person.name, value: c.metrics.current.commits })) });
        return {
          periodDays: o.days,
          totals: { ...o.totals, onTimePercent: pct(o.totals.onTimeRate), onTimeRate: undefined },
          whatIsGoingOn: o.pulse,
          dataQuality: o.quality.importedTasks ? `${o.quality.importedTasks} tasks from bulk-import days (${o.quality.importDays.join(", ")}) are excluded` : "no import days found",
          people: o.cards.map((c) => ({ name: c.person.name, role: c.person.role ? ROLE_LABEL[c.person.role] : "not set", designation: LEVEL_LABEL[c.person.level], tasksFinished: c.metrics.current.completed, onTimePercent: pct(c.metrics.current.onTimeRate), commits: c.usesCode ? c.metrics.current.commits : undefined, prsMerged: c.usesCode ? c.metrics.current.prsMerged : undefined, weeksOfHistory: c.history.weeks, notes: c.notes.map((n) => n.text) })),
          risks: o.risks.slice(0, 10).map((r) => r.message),
        };
      },
    ),

    tool(
      "get_person_report",
      "Everything about one developer: what is going on, tasks assigned/completed, on-time rate, tasks by project and status, commits and pull requests per repository (merged, open, closed), forecast for their open work, 2-week capacity, and their work split by project, layer (frontend/backend/...) and repository.",
      { person: { type: "string", description: "Name of the person" }, days },
      ["person"],
      (a) => {
        const data = ds();
        const p = findPerson(data, a.person);
        const d = range(a.days);
        const card = analyzeTeam(data, now, scoreDays(d)).find((c) => c.person.id === p.id)!;
        const m = card.metrics.current;
        const proj = personProjectBreakdown(data, p.id, listProjectDefs(workspaceId), now, d);
        const layers: Record<string, Work> = {};
        for (const pr of proj.projects) for (const [layer, w] of Object.entries(pr.byLayer)) { const t = (layers[layer] ??= { commits: 0, merges: 0, prsMerged: 0, prsOpen: 0 }); for (const k of Object.keys(t) as (keyof Work)[]) t[k] += w[k]; }
        addChart({ kind: "bars", title: `${p.name} · commits by layer`, data: Object.entries(layers).map(([label, w]) => ({ label, value: w.commits })) });
        addChart({ kind: "bars", title: `${p.name} · commits by repository`, data: proj.repos.slice(0, 6).map((r) => ({ label: r.repo.split("/").pop() ?? r.repo, value: r.commits })) });
        const f = personForecast(data, p.id, now);
        const w = personWork(data, p.id, listProjectDefs(workspaceId), now, d);
        return {
          name: p.name, role: p.role ? ROLE_LABEL[p.role] : "not set", designation: LEVEL_LABEL[p.level], firstInteraction: new Date(p.startDate).toISOString().slice(0, 10), periodDays: d,
          historyWeeks: card.profile.weeksOfHistory,
          whatIsGoingOn: card.notes.map((n) => n.text),
          tasks: { assigned: w.tasks.total, finished: w.tasks.finished, finishedUsedForPaceAndOnTime: m.completed, finishedFromBulkImport: w.tasks.notCounted, open: w.tasks.open, overdue: w.tasks.overdue, note: "assigned, finished, open and overdue are every task in the task tool and match the person's page; the pace and on-time figures leave out tasks closed by a bulk import because their dates are not real", onTimePercent: pct(m.onTimeRate), reopenedPercent: pct(m.reworkRate), medianDaysToFinish: m.cycleDaysMedian },
          taskInventory: { total: w.tasks.total, byStatus: w.tasks.byStatus.map((s) => ({ status: s.status, count: s.count })), byProject: w.tasks.byProject.map((p) => ({ project: p.project, total: p.total, statuses: p.statuses })), notInRatingBecauseOfBulkImport: w.tasks.notCounted },
          code: { commits: w.code.commits, mergeCommits: w.code.mergeCommits, prsMerged: w.code.prsMerged, prsOpen: w.code.prsOpen, prsClosedWithoutMerge: w.code.prsClosed, releaseMerges: w.code.releaseMerges, perRepository: w.code.byRepo.map((r) => ({ repo: r.repo, commits: r.commits, prsMerged: r.prsMerged, prsOpen: r.prsOpen, prsClosed: r.prsClosed })), medianHoursToMerge: m.prCycleHoursMedian, activeDays: m.activeDays },
          forecastForOpenWork: f?.forecast ? { openTasks: f.openTasks, likelyDone: new Date(f.forecast.p50).toISOString().slice(0, 10), safeDone: new Date(f.forecast.p80).toISOString().slice(0, 10), confidence: f.forecast.confidence } : { openTasks: f?.openTasks ?? 0 },
          capacityNext14Days: f ? { low: f.capacity.low, likely: f.capacity.likely, high: f.capacity.high, confidence: f.capacity.confidence } : null,
          byLayer: Object.fromEntries(Object.entries(layers).map(([k, w]) => [k, work(w)])),
          byProject: proj.projects.slice(0, 8).map((x) => ({ project: x.name, ...work(x.work), tasksDone: x.tasksDone, tasksOpen: x.tasksOpen, byLayer: Object.fromEntries(Object.entries(x.byLayer).map(([k, w]) => [k, work(w)])), byPart: Object.fromEntries(Object.entries(x.byPart).map(([k, w]) => [k, work(w)])) })),
          repositories: proj.repos.slice(0, 10).map((r) => ({ repo: r.repo, ...work(r) })),
          commitsInNoProject: proj.notInAnyProject.commits,
        };
      },
    ),

    tool(
      "compare_people",
      "Compare 2 to 5 developers side by side on the same period.",
      { people: { type: "array", items: { type: "string" }, description: "Names, 2 to 5" }, days },
      ["people"],
      (a) => {
        const data = ds();
        const d = range(a.days);
        const names: string[] = Array.isArray(a.people) ? a.people.slice(0, 5) : [];
        if (names.length < 2) throw new Error("Give at least two names to compare.");
        const cards = analyzeTeam(data, now, scoreDays(d));
        const defs = listProjectDefs(workspaceId);
        const rows = names.map((n) => {
          const p = findPerson(data, n);
          const c = cards.find((x) => x.person.id === p.id)!;
          const m = c.metrics.current;
          const w = personWork(data, p.id, defs, now, d);
          return { name: p.name, role: p.role ? ROLE_LABEL[p.role] : "not set", designation: LEVEL_LABEL[p.level], tasksFinished: w.tasks.finished, tasksOpen: w.tasks.open, tasksOverdue: w.tasks.overdue, onTimePercent: pct(m.onTimeRate), medianDaysToFinish: m.cycleDaysMedian, commits: w.code.commits, prsMerged: w.code.prsMerged, prsOpenNow: w.code.prsOpen, historyWeeks: c.profile.weeksOfHistory };
        });
        addChart({ kind: "bars", title: "Tasks finished", data: rows.map((r) => ({ label: r.name, value: r.tasksFinished })) });
        addChart({ kind: "bars", title: "Commits", data: rows.map((r) => ({ label: r.name, value: r.commits })) });
        return { periodDays: d, people: rows };
      },
    ),

    tool("list_projects", "List the projects the CXO has set up, with their repositories (and each repo's layer and part) and task lists.", {}, [], () => {
      const defs = listProjectDefs(workspaceId);
      return defs.length ? defs.map((p) => ({ name: p.name, repos: p.repos.map((r) => `${r.repo} [${r.layer}${r.part ? ` / ${r.part}` : ""}]`), taskLists: p.taskLists })) : { note: "No projects set up yet." };
    }),

    tool(
      "get_project_report",
      "A project in depth: total commits, PRs (by size) and tasks (by task list and tool: ClickUp or Jira), split by layer (frontend/backend/...) and part (admin/user/...), per repository, and every contributor with how much they did on each layer.",
      { project: { type: "string", description: "Project name" }, days: { type: "number", description: "Period in days: 7, 30, 90, 365, or 0 for everything on record (default 30)." } },
      ["project"],
      (a) => {
        const r = projectReport(ds(), findProject(workspaceId, a.project), now, range(a.days));
        addChart({ kind: "bars", title: `${r.project.name} · commits by layer`, data: r.layers.map((l) => ({ label: l.key, value: l.work.commits })) });
        addChart({ kind: "bars", title: `${r.project.name} · commits by person`, data: r.people.slice(0, 6).map((p) => ({ label: p.name, value: p.work.commits })) });
        return {
          project: r.project.name, periodDays: r.days,
          totals: { ...work(r.totals), contributors: r.totals.contributors, tasksCompleted: r.totals.tasksDone, tasksOpen: r.totals.tasksOpen },
          byLayer: r.layers.map((l) => ({ layer: l.key, repos: l.repos, ...work(l.work), contributors: l.contributors })),
          byPart: r.parts.map((l) => ({ part: l.key, ...work(l.work), contributors: l.contributors })),
          repositories: r.repos.map((x) => ({ repo: x.repo, layer: x.layer, part: x.part, ...work(x.work), contributors: x.contributors })),
          contributors: r.people.slice(0, 10).map((p) => ({ name: p.name, ...work(p.work), sharePercent: Math.round(p.shareOfCommits * 100), tasksCompleted: p.tasksDone, tasksOpen: p.tasksOpen, byLayer: Object.fromEntries(Object.entries(p.byLayer).map(([k, w]) => [k, work(w)])), medianHoursToMerge: p.prQuality.medianHoursToMerge, tasksByList: Object.values(p.byList).map((l) => `${l.source}: ${l.name} done ${l.done}, open ${l.open}`) })),
          taskLists: r.lists.map((l) => ({ tool: l.source, list: l.name, done: l.done, open: l.open })),
        };
      },
    ),

    tool(
      "get_repo_activity",
      "Repository-wise activity: commits and merged PRs (by size) per repository with its top contributors.",
      { days: { type: "number", description: "Period in days: 7, 30, 90, 365, or 0 for everything (default 30)." }, limit: { type: "number", description: "How many repositories (default 10)." } },
      [],
      (a) => {
        const rows = repoActivity(ds(), now, range(a.days)).slice(0, Math.min(Number(a.limit) || 10, 25));
        addChart({ kind: "bars", title: "Commits by repository", data: rows.slice(0, 6).map((r) => ({ label: r.repo.split("/").pop() ?? r.repo, value: r.commits })) });
        return rows.map((r) => ({ repo: r.repo, ...work(r), topContributors: r.contributors.slice(0, 3).map((c) => ({ name: c.name, commits: c.work.commits })) }));
      },
    ),

    tool(
      "forecast_tasks",
      "When would this developer finish N new tasks, given their own track record and experience level? Returns a likely date and a safer date.",
      { person: { type: "string" }, tasks: { type: "number", description: "How many tasks" } },
      ["person", "tasks"],
      async (a) => {
        const { forecastCompletion } = await import("./capability");
        const data = ds();
        const p = findPerson(data, a.person);
        const f = forecastCompletion(data, p, Math.max(1, Math.min(Number(a.tasks) || 1, 200)), now);
        if (!f) throw new Error("Give a number of tasks above zero.");
        const d = (t: number) => new Date(t).toISOString().slice(0, 10);
        return { person: p.name, tasks: f.tasks, likelyDone: d(f.p50), safeDone: d(f.p80), worstCase: d(f.p95), weeksLikely: f.weeksP50, confidence: f.confidence, note: f.confidence === "none" || f.confidence === "low" ? "Based mostly on the experience level because there is little history." : undefined };
      },
    ),

    tool("find_unlinked_accounts", "GitHub/ClickUp/Jira accounts whose activity is not yet credited to any developer (so their commits are missing from the totals).", {}, [], () =>
      unlinkedAccounts(workspaceId).slice(0, 20).map((u) => ({ provider: u.provider, account: u.externalId, commits: u.commits, prs: u.prs })),
    ),
  ];

  return { tools, charts };
}
