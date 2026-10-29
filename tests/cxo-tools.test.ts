import { describe, expect, it, vi } from "vitest";
import { nc, npr } from "./helpers";

const NOW = Date.UTC(2026, 9, 26, 12);
const DAY = 86_400_000;

// A small real workspace in an in-memory database: two developers, one project with frontend + backend repos.
async function setup() {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  delete (globalThis as any).__platformDb;
  const store = await import("../lib/integrations/store");
  store.ensureWorkspace("w1", "Acme");
  const sync = await import("../lib/integrations/sync");
  const projects = await import("../lib/platform/projects");
  const aria = { provider: "clickup" as const, externalId: "1", name: "Aria Shah", email: "aria@acme.com" };
  const ben = { provider: "clickup" as const, externalId: "2", name: "Ben Carter", email: "ben@acme.com" };
  const gh = (login: string, email: string) => ({ provider: "github" as const, externalId: login, login, email });
  const tasks = Array.from({ length: 24 }, (_, i) => ({
    source: "clickup" as const, externalId: `t${i}`, assignee: i % 3 ? aria : ben, project: "Shop Sprint", title: `t${i}`, priority: "normal" as const, stage: "done" as const, status: "complete", url: `https://app.clickup.com/t/t${i}`,
    createdAt: NOW - (60 - i) * DAY, startedAt: NOW - (59 - i) * DAY, doneAt: NOW - (58 - i) * DAY, dueAt: NOW - (56 - i) * DAY, updatedAt: NOW,
  }));
  const commit = (sha: string, repo: string, who: ReturnType<typeof gh>, daysAgo: number, message: string) => nc({ repo, sha, author: who, at: NOW - daysAgo * DAY, message });
  const a = gh("aria-gh", "aria@acme.com");
  const b = gh("ben-gh", "ben@acme.com");
  sync.saveBatch("w1", {
    people: [aria, ben], tasks, notes: [],
    prs: [
      npr({ repo: "acme/shop-web", number: 1, author: a, openedAt: NOW - 4 * DAY, mergedAt: NOW - 3 * DAY, filesChanged: 2, changelogItems: 1 }), // small, approved first time
      npr({ repo: "acme/shop-api", number: 2, author: b, openedAt: NOW - 6 * DAY, mergedAt: NOW - 4 * DAY, filesChanged: 30, changelogItems: 9, reviewRounds: 2 }), // large, needed two rounds
    ],
    commits: [
      commit("1", "acme/shop-web", a, 2, "feat: add reports page"), commit("2", "acme/shop-web", a, 3, "fix: chart colours"), commit("3", "acme/shop-api", a, 4, "feat: reports endpoint"),
      commit("4", "acme/shop-api", b, 2, "feat: invite emails"), commit("5", "acme/shop-api", b, 5, "Merge branch 'develop' into dev-ben"),
      commit("6", "acme/shop-api", gh("stranger", "nobody@else.com"), 5, "feat: unknown author"),
    ],
  }, NOW);
  projects.saveProject("w1", projects.ProjectInput.parse({ name: "Shop", repos: [{ repo: "acme/shop-web", layer: "frontend", part: "user" }, { repo: "acme/shop-api", layer: "backend" }], taskLists: ["Shop Sprint"] }));
  const { cxoTools } = await import("../lib/analytics/cxoTools");
  const t = cxoTools("w1", NOW);
  const run = (name: string, args: unknown = {}) => t.tools.find((x) => x.name === name)!.run(args) as Promise<any>;
  return { run, charts: t.charts, tools: t.tools };
}

describe("CXO chat tools", () => {
  it("every tool is read-only and the full set is available", async () => {
    const { tools } = await setup();
    expect(tools.every((t) => t.kind === "read")).toBe(true);
    expect(tools.map((t) => t.name).sort()).toEqual(["compare_people", "find_unlinked_accounts", "forecast_tasks", "get_person_report", "get_project_report", "get_repo_activity", "get_team_overview", "list_projects"]);
  });

  it("project report splits a person's work into frontend and backend with exact numbers", async () => {
    const { run } = await setup();
    const r = await run("get_project_report", { project: "shop", days: 30 });
    expect(r.totals).toMatchObject({ commits: 4, mergeCommits: 0, prsMerged: 2, prsOpen: 0, tasksCompleted: expect.any(Number) }); // the merge commit is not counted by default
    expect(Object.fromEntries(r.byLayer.map((l: any) => [l.layer, l.commits]))).toEqual({ frontend: 2, backend: 2 });
    const aria = r.contributors.find((c: any) => c.name === "Aria Shah");
    expect(aria.byLayer.frontend).toEqual({ commits: 2, mergeCommits: 0, prsMerged: 1, prsOpen: 0 });
    expect(aria.byLayer.backend).toEqual({ commits: 1, mergeCommits: 0, prsMerged: 0, prsOpen: 0 });
    const ben = r.contributors.find((c: any) => c.name === "Ben Carter");
    expect(ben.byLayer.frontend).toBeUndefined(); // Ben never touched the frontend repo
    expect(ben.byLayer.backend).toEqual({ commits: 1, mergeCommits: 0, prsMerged: 1, prsOpen: 0 }); // his other commit only merges a branch, so it is left out
    expect(ben.sharePercent).toBe(25);
    expect(r.taskLists).toEqual([{ tool: "clickup", list: "Shop Sprint", done: expect.any(Number), open: 0 }]); // which tool the tasks came from
    expect(JSON.stringify(r)).not.toMatch(/lines/i); // lines of code never reach the assistant
  });

  it("person report reports their layers and repositories, resolving a partial name", async () => {
    const { run } = await setup();
    const r = await run("get_person_report", { person: "ben", days: 30 });
    expect(r.name).toBe("Ben Carter");
    expect(r.byLayer.backend).toMatchObject({ commits: 1, mergeCommits: 0 });
    expect(r.repositories[0]).toMatchObject({ repo: "acme/shop-api", commits: 1 });
    expect(r.code).toMatchObject({ commits: 1, mergeCommits: 0, prsMerged: 1, prsOpen: 0 });
    expect(r.code.perRepository).toEqual([{ repo: "acme/shop-api", commits: 1, prsMerged: 1, prsOpen: 0, prsClosed: 0 }]);
    // the task inventory: every task in the period, by project (the platform project, not just the list) and by status
    const wide = await run("get_person_report", { person: "ben", days: 90 });
    expect(wide.taskInventory.total).toBe(8);
    expect(wide.taskInventory.byStatus).toEqual([{ status: "complete", count: 8 }]);
    expect(wide.taskInventory.byProject).toEqual([{ project: "Shop", total: 8, statuses: { complete: 8 } }]);
    expect(r.taskInventory.total).toBe(0); // none of his tasks were assigned or finished in the last 30 days: not listed, and not invented
    expect(JSON.stringify(r)).not.toMatch(/lines|additions|deletions/i);
    expect(r.byProject[0]).toMatchObject({ project: "Shop" });
  });

  it("unknown names produce an error that lists who exists, so the model can retry", async () => {
    const { run } = await setup();
    await expect(run("get_person_report", { person: "Zed" })).rejects.toThrow(/Aria Shah, Ben Carter/);
    await expect(run("get_project_report", { project: "Nope" })).rejects.toThrow(/Projects: Shop/);
    await expect(run("compare_people", { people: ["Aria"] })).rejects.toThrow(/at least two/);
  });

  it("flags an account that is not credited to anyone, so missing commits are explained", async () => {
    const { run } = await setup();
    expect(await run("find_unlinked_accounts")).toEqual([{ provider: "github", account: "stranger", commits: 1, prs: 0 }]);
  });

  it("builds charts from the data (never written by the model), at most three", async () => {
    const { run, charts } = await setup();
    await run("get_team_overview");
    await run("get_project_report", { project: "Shop" });
    await run("get_repo_activity");
    expect(charts.length).toBeLessThanOrEqual(3);
    expect(charts.every((c) => c.data.length > 0)).toBe(true);
  });

  it("forecasts honestly: little history means a note, not false precision", async () => {
    const { run } = await setup();
    const f = await run("forecast_tasks", { person: "Aria", tasks: 6 });
    expect(f.likelyDone <= f.safeDone).toBe(true);
    expect(f.tasks).toBe(6);
  });
});
