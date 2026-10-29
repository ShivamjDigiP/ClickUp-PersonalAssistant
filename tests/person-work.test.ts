import { describe, expect, it, vi } from "vitest";
import { personWork, deadlineOf } from "../lib/analytics/personWork";
import { personMetrics } from "../lib/analytics/metrics";
import { flagImportedTasks } from "../lib/analytics/clean";
import { DAY, type CommitRec, type Dataset, type PrRec, type TaskRec } from "../lib/analytics/types";
import type { ProjectDef } from "../lib/analytics/projects";

const NOW = Date.UTC(2026, 9, 26, 12);
const me = { id: "me", name: "Shivam", level: "mid" as const, startDate: NOW - 200 * DAY };
const other = { id: "ben", name: "Ben", level: "mid" as const, startDate: NOW - 200 * DAY };

const task = (id: string, o: Partial<TaskRec> = {}): TaskRec => ({
  id: `clickup:${id}`, externalId: id, url: `https://app.clickup.com/t/${id}`, personId: "me", source: "clickup", project: "RakshakIQ", title: `Task ${id}`, priority: "normal",
  stage: "done", status: "complete", createdAt: NOW - 20 * DAY, doneAt: NOW - 10 * DAY, dueAt: NOW - 8 * DAY, ...o,
});
const open = (id: string, o: Partial<TaskRec> = {}) => task(id, { stage: "doing", status: "in development", doneAt: undefined, dueAt: NOW + 3 * DAY, ...o });
const commit = (sha: string, o: Partial<CommitRec> = {}): CommitRec => ({ personId: "me", repo: "acme/shop-web", sha, at: NOW - 3 * DAY, message: "Add reports", kind: "feature", trivial: false, vague: false, ...o });
const pr = (n: number, o: Partial<PrRec> = {}): PrRec => ({ personId: "me", repo: "acme/shop-web", number: n, title: `PR ${n}`, baseBranch: "develop", headBranch: "feat/x", state: "merged", openedAt: NOW - 6 * DAY, mergedAt: NOW - 5 * DAY, kind: "feature", scope: "medium", commitCount: 2, reviewRounds: 0, approvals: 1, reviewed: true, promotion: false, ...o });

const security: ProjectDef = { id: "p1", name: "Security", repos: [{ repo: "acme/shop-web", layer: "frontend", part: "admin" }], taskLists: ["RakshakIQ"] };

describe("personWork: the task inventory", () => {
  const ds: Dataset = {
    people: [me, other],
    tasks: [
      task("a1"), task("a2", { priority: "high" }),
      task("late", { doneAt: NOW - 2 * DAY, dueAt: NOW - 9 * DAY }), // finished well after its due date
      open("o1"), open("o2", { dueAt: NOW - DAY, status: "backlog", stage: "todo" }), // overdue
      open("o3", { status: "in review", stage: "review", dueAt: undefined }),
      task("imp1", { createdAt: NOW - 19 * DAY, doneAt: NOW - 19 * DAY + 3600_000, dueAt: NOW - 30 * DAY, imported: true }), // closed by a bulk import
      task("other", { personId: "ben" }), // someone else's
      task("old", { createdAt: NOW - 200 * DAY, doneAt: NOW - 150 * DAY }), // finished long before the period
    ],
    commits: [],
    prs: [],
  };
  const w = personWork(ds, "me", [security], NOW, 30);

  it("counts every task assigned, finished or still open in the period, the way the task tool does", () => {
    expect(w.tasks.total).toBe(7); // a1 a2 late o1 o2 o3 imp1: not Ben's, not the one finished 150 days ago
    expect(w.tasks.finished).toBe(4);
    expect(w.tasks.open).toBe(3);
    expect(w.tasks.overdue).toBe(1);
  });

  it("covers everything on record when asked", () => {
    expect(personWork(ds, "me", [security], NOW, 0).tasks.total).toBe(8);
  });

  it("breaks tasks down by status, in workflow order, using the tool's own status names", () => {
    expect(w.tasks.byStatus).toEqual([
      { status: "backlog", stage: "todo", count: 1 },
      { status: "in development", stage: "doing", count: 2 - 1 },
      { status: "in review", stage: "review", count: 1 },
      { status: "complete", stage: "done", count: 4 },
    ]);
  });

  it("breaks tasks down by platform project and status (the project, not just the list name)", () => {
    expect(w.tasks.byProject).toEqual([{ project: "Security", total: 7, statuses: { backlog: 1, "in development": 1, "in review": 1, complete: 4 } }]);
    const noProject = personWork(ds, "me", [], NOW, 30);
    expect(noProject.tasks.byProject[0].project).toBe("RakshakIQ"); // unmapped lists keep their own name
  });

  it("lists the tasks, open ones first (overdue before due-soon), each with a link to open it", () => {
    expect(w.tasks.items.map((t) => t.id.replace("clickup:", "")).slice(0, 3)).toEqual(["o2", "o1", "o3"]);
    expect(w.tasks.items[0]).toMatchObject({ url: "https://app.clickup.com/t/o2", status: "backlog", project: "Security", list: "RakshakIQ", deadline: "overdue", counted: true });
  });

  it("keeps bulk-imported tasks in the list and the totals, marked as not counted toward the rating", () => {
    expect(w.tasks.notCounted).toBe(1);
    const imp = w.tasks.items.find((t) => t.id === "clickup:imp1")!;
    expect(imp.counted).toBe(false);
    expect(imp.deadline).toBe("due"); // its finish date is the import's, so it is never called "late"
  });

  it("says whether each finished task was on time or late", () => {
    const by = Object.fromEntries(w.tasks.items.map((t) => [t.id.replace("clickup:", ""), t.deadline]));
    expect(by.a1).toBe("on_time");
    expect(by.late).toBe("late");
    expect(by.o1).toBe("due");
    expect(by.o3).toBeNull(); // no due date
  });

  it("marks subtasks and counts them, because task tools count them differently (ClickUp's board hides them by default)", () => {
    const withSub: Dataset = { ...ds, tasks: [...ds.tasks, task("sub1", { parent: "a1" }), open("sub2", { parent: "o1" })] };
    const x = personWork(withSub, "me", [security], NOW, 30).tasks;
    expect(x.subtasks).toBe(2);
    expect(x.total).toBe(9); // subtasks are in the total, exactly like ClickUp's own count with its Subtasks switch on
    expect(x.items.filter((t) => t.subtask).map((t) => t.id.replace("clickup:", "")).sort()).toEqual(["sub1", "sub2"]);
    expect(x.finished - w.tasks.finished).toBe(1);
  });

  it("deadlineOf allows a day of grace", () => {
    expect(deadlineOf({ dueAt: NOW, doneAt: NOW + DAY - 1 }, NOW)).toBe("on_time");
    expect(deadlineOf({ dueAt: NOW, doneAt: NOW + DAY + 1 }, NOW)).toBe("late");
  });
});

describe("imported tasks and the rating", () => {
  // 40 tasks all created and closed on one day by an import, plus a few real ones and a real open one
  const imported = Array.from({ length: 40 }, (_, i) => task(`i${i}`, { createdAt: NOW - 19 * DAY + i, doneAt: NOW - 19 * DAY + 60_000 + i, dueAt: NOW - 25 * DAY }));
  const real = Array.from({ length: 6 }, (_, i) => task(`r${i}`, { createdAt: NOW - (12 - i) * DAY, doneAt: NOW - (10 - i) * DAY, dueAt: NOW - (9 - i) * DAY }));
  const raw: Dataset = { people: [me], tasks: [...imported, ...real, open("still", { createdAt: NOW - 19 * DAY, dueAt: NOW - 2 * DAY })], commits: [], prs: [] };
  const flagged = flagImportedTasks(raw);

  it("flags the import and removes nothing", () => {
    expect(flagged.tasks).toHaveLength(47);
    expect(flagged.tasks.filter((t) => t.imported).length).toBeGreaterThanOrEqual(40);
  });

  it("leaves imported tasks out of speed and on-time numbers but keeps their open work", () => {
    const m = personMetrics(flagged, "me", NOW, 30).current;
    expect(m.completed).toBe(6); // only the six with real dates
    expect(m.importedDone).toBe(40);
    expect(m.onTimeRate).toBe(1);
    expect(m.openNow).toBe(1); // the open imported-era task is still real open work
    expect(m.overdueOpen).toBe(1);
  });

  it("but the task list and totals still show all of them", () => {
    const w = personWork(flagged, "me", [], NOW, 30);
    expect(w.tasks.finished).toBe(46);
    expect(w.tasks.notCounted).toBeGreaterThanOrEqual(40);
  });
});

describe("personWork: GitHub activity in plain counts, with links", () => {
  const ds: Dataset = {
    people: [me, other],
    tasks: [],
    commits: [
      commit("aaa1111111", { message: "Add reports page", prNumber: 4 }),
      commit("bbb2222222", { message: "Merge branch 'develop' into dev-me", kind: "merge", trivial: true }),
      commit("ccc3333333", { repo: "acme/shop-api", message: "fix: payment rounding" }),
      commit("old4444444", { at: NOW - 80 * DAY }), // outside the period
      commit("ben5555555", { personId: "ben" }), // someone else's
    ],
    prs: [
      pr(4), pr(5, { state: "open", mergedAt: undefined, openedAt: NOW - 2 * DAY }), pr(6, { state: "closed", mergedAt: undefined, openedAt: NOW - 8 * DAY }),
      pr(7, { repo: "acme/shop-api", reviewRounds: 2, approvals: 0 }),
      pr(8, { headBranch: "develop", baseBranch: "main", promotion: true }), // a release merge
      pr(9, { personId: "ben" }),
    ],
  };
  const c = personWork(ds, "me", [security], NOW, 30).code;

  it("counts commits, merge-only commits and pull requests by state", () => {
    expect(c).toMatchObject({ commits: 3, mergeCommits: 1, prsMerged: 2, prsOpen: 1, prsClosed: 1, releaseMerges: 1 });
  });

  it("shows, per repository, commits and PRs merged, open and closed, and which project it belongs to", () => {
    const web = c.byRepo.find((r) => r.repo === "acme/shop-web")!;
    const api = c.byRepo.find((r) => r.repo === "acme/shop-api")!;
    expect(web).toMatchObject({ commits: 2, mergeCommits: 1, prsMerged: 1, prsOpen: 1, prsClosed: 1, project: "Security", layer: "frontend", part: "admin", url: "https://github.com/acme/shop-web" });
    expect(api).toMatchObject({ commits: 1, prsMerged: 1, prsOpen: 0, project: null });
  });

  it("links every commit and pull request to GitHub", () => {
    expect(c.commitItems[0]).toMatchObject({ url: expect.stringMatching(/^https:\/\/github\.com\/acme\/shop-(web|api)\/commit\/[a-z0-9]+$/), shortSha: expect.any(String) });
    const first = c.commitItems.find((x) => x.sha === "aaa1111111")!;
    expect(first).toMatchObject({ url: "https://github.com/acme/shop-web/commit/aaa1111111", shortSha: "aaa1111", prNumber: 4, message: "Add reports page", isMerge: false });
    expect(c.prItems.find((p) => p.number === 4)!.url).toBe("https://github.com/acme/shop-web/pull/4");
  });

  it("lists open pull requests first, and release merges are listed but marked, not counted as the person's own", () => {
    expect(c.prItems[0].state).toBe("open");
    expect(c.prItems.find((p) => p.number === 8)).toMatchObject({ release: true, baseBranch: "main", headBranch: "develop" });
    expect(c.prsMerged).toBe(2);
  });

  it("reports review facts without labelling them", () => {
    expect(c.prItems.find((p) => p.number === 7)).toMatchObject({ changesRequested: 2, approvals: 0, reviewed: true });
  });

  it("never contains lines of code", () => {
    expect(JSON.stringify(c)).not.toMatch(/additions|deletions|lines/i);
  });
});

describe("the status name is stored and read back", () => {
  it("a ClickUp-style batch keeps its status through the database into the task list", async () => {
    vi.resetModules();
    process.env.PLATFORM_DB = ":memory:";
    delete (globalThis as any).__platformDb;
    const store = await import("../lib/integrations/store");
    store.ensureWorkspace("w1", "W");
    const { saveBatch } = await import("../lib/integrations/sync");
    const { loadDataset } = await import("../lib/analytics/load");
    const a = { provider: "clickup" as const, externalId: "1", name: "Shivam", email: "s@x.com" };
    saveBatch("w1", {
      people: [a], notes: [], commits: [], prs: [],
      tasks: [
        { source: "clickup", externalId: "t1", assignee: a, project: "RakshakIQ", title: "Bug fixes : Admin", priority: "high", stage: "doing", status: "in development", createdAt: NOW - 5 * DAY, dueAt: NOW + DAY, url: "https://app.clickup.com/t/t1", updatedAt: NOW },
        { source: "clickup", externalId: "t2", assignee: a, project: "RakshakIQ", title: "Done thing", priority: "normal", stage: "done", status: "complete", createdAt: NOW - 9 * DAY, doneAt: NOW - 3 * DAY, url: "https://app.clickup.com/t/t2", updatedAt: NOW },
      ],
    }, NOW);
    const ds = loadDataset("w1");
    const w = personWork(ds, ds.people[0].id, [], NOW, 30);
    expect(w.tasks.byStatus.map((s) => `${s.status}:${s.count}`)).toEqual(["in development:1", "complete:1"]);
    expect(w.tasks.items.find((t) => t.title === "Bug fixes : Admin")).toMatchObject({ status: "in development", url: "https://app.clickup.com/t/t1", priority: "high", source: "clickup" });
  });
});
