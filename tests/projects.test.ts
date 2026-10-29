import { describe, expect, it } from "vitest";
import { personProjectBreakdown, projectReport, repoActivity, suggestLayer, suggestPart, suggestProjects, type ProjectDef } from "../lib/analytics/projects";
import { DAY, type CommitRec, type Dataset, type PrRec, type TaskRec } from "../lib/analytics/types";
import type { ChangeKind } from "../lib/analytics/changes";

const NOW = Date.UTC(2026, 9, 26, 12);
const people = [
  { id: "a", name: "Aria", level: "senior" as const, startDate: NOW - 400 * DAY },
  { id: "b", name: "Ben", level: "mid" as const, startDate: NOW - 400 * DAY },
];
const commit = (personId: string, repo: string, daysAgo: number, kind: ChangeKind = "feature"): CommitRec => ({ personId, repo, sha: `${personId}${repo}${daysAgo}${kind}`, at: NOW - daysAgo * DAY, message: `${kind}: work`, kind, trivial: kind === "merge" || kind === "chore", vague: false });
const pr = (personId: string, repo: string, n: number, mergedDaysAgo: number, o: Partial<PrRec> = {}): PrRec => ({ personId, repo, number: n, title: `PR ${n}`, state: "merged", openedAt: NOW - (mergedDaysAgo + 1) * DAY, mergedAt: NOW - mergedDaysAgo * DAY, kind: "feature", scope: "medium", commitCount: 2, reviewRounds: 0, approvals: 1, reviewed: true, promotion: false, ...o });
const task = (personId: string, project: string, id: string, doneDaysAgo?: number, source = "clickup"): TaskRec => ({ id, personId, source, project, title: id, priority: "normal", stage: doneDaysAgo === undefined ? "doing" : "done", createdAt: NOW - 40 * DAY, doneAt: doneDaysAgo === undefined ? undefined : NOW - doneDaysAgo * DAY });

const shop: ProjectDef = {
  id: "p1", name: "Shop",
  repos: [
    { repo: "acme/shop-web", layer: "frontend", part: "user" },
    { repo: "acme/shop-admin-web", layer: "frontend", part: "admin" },
    { repo: "acme/shop-api", layer: "backend", part: null },
  ],
  taskLists: ["Shop Sprint", "SHOP"],
};

const ds: Dataset = {
  people,
  commits: [
    commit("a", "acme/shop-web", 2), commit("a", "acme/shop-web", 3, "fix"), commit("a", "acme/shop-api", 4),
    commit("b", "acme/shop-api", 2), commit("b", "acme/shop-api", 5, "merge"), commit("b", "acme/shop-api", 6, "chore"), commit("b", "acme/shop-admin-web", 3, "fix"),
    commit("a", "acme/other-tool", 2), // not part of the project
    commit("a", "acme/shop-web", 80), // outside a 30-day window
  ],
  prs: [
    pr("a", "acme/shop-web", 1, 3, { scope: "small" }),
    pr("b", "acme/shop-api", 2, 4, { scope: "large", reviewRounds: 2 }),
    pr("b", "acme/shop-api", 3, 100), // outside the window
    pr("b", "acme/shop-api", 4, 5, { reviewed: false, approvals: 0 }), // merged without anyone reviewing it
    pr("b", "acme/shop-api", 5, 2, { promotion: true }), // develop -> main: a release step, not Ben's delivery
    pr("b", "acme/shop-web", 6, 0, { state: "open", mergedAt: undefined, openedAt: NOW - 2 * DAY }), // still open
    pr("a", "acme/shop-web", 7, 0, { state: "closed", mergedAt: undefined }), // closed without merging: not a merged PR
  ],
  tasks: [task("a", "Shop Sprint", "t1", 5), task("b", "Shop Sprint", "t2", 6), task("b", "Shop Sprint", "t3"), task("a", "Other", "t4", 2), task("a", "SHOP", "j1", 4, "jira"), task("b", "SHOP", "j2", 3, "jira"), task("b", "SHOP", "j3", 9, "jira")],
};

describe("projectReport", () => {
  const r = projectReport(ds, shop, NOW, 30);

  it("adds up only the project's repos and task lists inside the window", () => {
    expect(r.totals).toMatchObject({ commits: 7, merges: 1, prsMerged: 3, prsOpen: 1, tasksDone: 5, tasksOpen: 1, contributors: 2 });
    expect(r.repos.map((x) => x.repo)).toEqual(["acme/shop-api", "acme/shop-web", "acme/shop-admin-web"]);
  });

  it("counts merge-only commits separately and has no line counts anywhere", () => {
    expect(r.totals.commits - r.totals.merges).toBe(6);
    expect(JSON.stringify(r)).not.toMatch(/additions|deletions|lines|meaningful/i);
  });

  it("counts open pull requests on their own, and never counts closed-unmerged ones as merged", () => {
    expect(r.totals.prsMerged).toBe(3);
    expect(r.totals.prsOpen).toBe(1);
    expect(r.people.find((p) => p.personId === "b")!.work.prsOpen).toBe(1);
    expect(r.people.find((p) => p.personId === "a")!.work.prsOpen).toBe(0);
  });

  it("splits the project by layer, so the CXO sees frontend versus backend", () => {
    const layer = Object.fromEntries(r.layers.map((l) => [l.key, l]));
    expect(layer.frontend.work.commits).toBe(3); // shop-web x2 + shop-admin-web x1
    expect(layer.backend.work.commits).toBe(4);
    expect(layer.frontend.repos).toEqual(["acme/shop-admin-web", "acme/shop-web"]);
    expect(layer.backend.contributors).toBe(2);
  });

  it("splits by part (admin / user) independently of layer", () => {
    const part = Object.fromEntries(r.parts.map((l) => [l.key, l]));
    expect(part.admin.work.commits).toBe(1);
    expect(part.user.work.commits).toBe(2);
    expect(part["(no part)"].work.commits).toBe(4);
  });

  it("shows what each person did on each layer, part and repo, and their share", () => {
    const aria = r.people.find((p) => p.personId === "a")!;
    const ben = r.people.find((p) => p.personId === "b")!;
    expect(aria.byLayer.frontend.commits).toBe(2);
    expect(aria.byLayer.backend.commits).toBe(1);
    expect(ben.byLayer.backend.commits).toBe(3);
    expect(ben.byLayer.backend.merges).toBe(1); // of his 3 backend commits, one only merges a branch
    expect(ben.byPart.admin.commits).toBe(1);
    expect(aria.shareOfCommits + ben.shareOfCommits).toBeCloseTo(1);
    expect(aria.kinds).toEqual({ feature: 2, fix: 1 });
  });

  it("measures how smoothly each person's pull requests shipped", () => {
    const aria = r.people.find((p) => p.personId === "a")!;
    const ben = r.people.find((p) => p.personId === "b")!;
    expect(aria.prQuality).toMatchObject({ reviewed: 1, firstPass: 1 });
    expect(ben.prQuality).toMatchObject({ reviewed: 1, firstPass: 0 }); // his reviewed PR needed two rounds of changes; the unreviewed one is not counted either way
    expect(ben.prQuality.medianHoursToMerge).toBeGreaterThan(0);
    expect(r.totals).toMatchObject({ reviewed: 2, firstPass: 1 });
  });

  it("breaks tasks down by list and by the tool they came from, so it can be filtered by ClickUp or Jira", () => {
    expect(r.sources).toEqual(["clickup", "jira"]);
    const jira = r.lists.find((l) => l.source === "jira")!;
    const cu = r.lists.find((l) => l.source === "clickup")!;
    expect(jira).toMatchObject({ name: "SHOP", done: 3, open: 0, people: 2 }); // j1, j2 and j3 (9 days ago) all fall inside 30 days
    expect(cu).toMatchObject({ name: "Shop Sprint", done: 2, open: 1 });
    const ben = r.people.find((p) => p.personId === "b")!;
    expect(ben.byList["jira::SHOP"]).toMatchObject({ done: 2, open: 0 });
    expect(ben.byList["clickup::Shop Sprint"]).toMatchObject({ done: 1, open: 1 });
  });

  it("matches repo and list names regardless of letter case", () => {
    const loud = projectReport(ds, { ...shop, repos: shop.repos.map((x) => ({ ...x, repo: x.repo.toUpperCase() })), taskLists: ["SHOP SPRINT"] }, NOW, 30);
    expect(loud.totals.commits).toBe(7);
    expect(loud.totals.tasksDone).toBe(2);
  });

  it("days = 0 means everything on record", () => {
    expect(projectReport(ds, shop, NOW, 0).totals.commits).toBe(8);
  });
});

describe("repoActivity and person breakdown", () => {
  it("ranks repos and lists contributors per repo", () => {
    const rows = repoActivity(ds, NOW, 30);
    expect(rows[0].repo).toBe("acme/shop-api");
    expect(rows[0].contributors.map((c) => [c.name, c.work.commits])).toEqual([["Ben", 3], ["Aria", 1]]);
  });

  it("totals one person per project, and reports work that is in no project", () => {
    const b = personProjectBreakdown(ds, "a", [shop], NOW, 30);
    expect(b.projects).toHaveLength(1);
    expect(b.projects[0]).toMatchObject({ name: "Shop", tasksDone: 2 });
    expect(b.projects[0].work.commits).toBe(3);
    expect(b.notInAnyProject.commits).toBe(1); // acme/other-tool
    expect(b.repos.map((r) => r.repo)).toContain("acme/other-tool");
  });
});

describe("suggestions", () => {
  it("guesses layer and part from repository names, and says nothing when unsure", () => {
    expect(suggestLayer("acme/shop-web")).toBe("frontend");
    expect(suggestLayer("acme/shop-api")).toBe("backend");
    expect(suggestLayer("acme/shop-android")).toBe("mobile");
    expect(suggestLayer("acme/shop-terraform")).toBe("infra");
    expect(suggestLayer("acme/miscellany")).toBeNull();
    expect(suggestPart("acme/shop-admin-web")).toBe("admin");
    expect(suggestPart("acme/shop-user-api")).toBe("user");
    expect(suggestPart("acme/shop-api")).toBeNull();
  });

  it("groups repositories that share a name prefix into a suggested project", () => {
    const s = suggestProjects(["acme/shop-web", "acme/shop-api", "acme/shop-admin-web", "acme/tool", "acme/blog-web"]);
    expect(s).toHaveLength(1);
    expect(s[0].name).toBe("Shop");
    expect(s[0].repos.map((r) => `${r.repo}:${r.layer}:${r.part}`)).toEqual(["acme/shop-web:frontend:null", "acme/shop-api:backend:null", "acme/shop-admin-web:frontend:admin"]);
  });
});

describe("tasks by status", () => {
  it("shows where a project's tasks are, in the tool's own status names and workflow order", () => {
    const withStatus: Dataset = {
      ...ds,
      tasks: [
        { ...task("a", "Shop Sprint", "s1", 5), status: "complete" },
        { ...task("b", "Shop Sprint", "s2"), status: "in development", stage: "doing" },
        { ...task("a", "Shop Sprint", "s3"), status: "in development", stage: "doing" },
        { ...task("b", "Shop Sprint", "s4"), status: "backlog", stage: "todo" },
        { ...task("a", "Other", "s5"), status: "complete" }, // a different list: not part of this project
      ],
    };
    const r = projectReport(withStatus, shop, NOW, 30);
    expect(r.statuses).toEqual([
      { status: "backlog", stage: "todo", count: 1 },
      { status: "in development", stage: "doing", count: 2 },
      { status: "complete", stage: "done", count: 1 },
    ]);
  });
});
