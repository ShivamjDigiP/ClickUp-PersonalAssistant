import { afterEach, describe, expect, it, vi } from "vitest";
import { bestTaskFor, reconcile, similarity } from "../lib/sync/match";
import { describeMeta } from "../lib/llm/engine";
import type { SyncPr, SyncTask } from "../lib/sync/types";

const task = (over: Partial<SyncTask>): SyncTask => ({ id: "t1", name: "Task", status: "in progress", done: false, backlog: false, url: "u", list: "L", listId: "l1", updated: "2026-10-20", ...over });
const pr = (over: Partial<SyncPr>): SyncPr => ({ repo: "acme/app", number: 1, title: "A PR", state: "open", url: "u", updated: "2026-10-20", draft: false, taskIds: [], ...over });
const want = (_t: SyncTask, s: "open" | "merged") => (s === "merged" ? "complete" : "in progress");

const run = (prs: SyncPr[], mine: SyncTask[], referenced = new Map(mine.map((t) => [t.id, t]))) =>
  reconcile({ prs, mine, referenced, windowStart: "2026-10-01", wantedStatus: want });

afterEach(() => vi.unstubAllGlobals());

describe("similarity", () => {
  it("matches overlapping titles and ignores filler and ids", () => {
    expect(similarity("Add login page validation", "login page")).toBe(1);
    expect(similarity("fix: CU-86abc login bug", "Payment export")).toBe(0);
  });

  it("needs at least two shared words, so one coincidence is not a match", () => {
    expect(bestTaskFor("Improve dashboard", [task({ name: "Dashboard" })])).toBeUndefined();
    expect(bestTaskFor("Improve dashboard charts", [task({ id: "a", name: "Dashboard charts rework" })])?.task.id).toBe("a");
  });
});

describe("reconcile", () => {
  it("flags a merged PR whose task is not done, and says what status to use", () => {
    const { items } = run([pr({ state: "merged", taskIds: ["t1"] })], [task({ status: "in review" })]);
    expect(items).toMatchObject([{ kind: "status", want: "complete" }]);
  });

  it("counts a merged PR with a done task as in sync", () => {
    const { items, inSync } = run([pr({ state: "merged", taskIds: ["t1"] })], [task({ status: "complete", done: true })]);
    expect(items).toEqual([]);
    expect(inSync).toBe(1);
  });

  it("flags an open PR whose task is still in the backlog", () => {
    const { items } = run([pr({ taskIds: ["t1"] })], [task({ status: "to do", backlog: true })]);
    expect(items[0]).toMatchObject({ kind: "status", want: "in progress" });
  });

  it("reports a PR with no task, with a likely match by title", () => {
    const { items } = run([pr({ title: "Add login page validation" })], [task({ id: "t9", name: "Login page validation", status: "to do", backlog: true })]);
    expect(items[0]).toMatchObject({ kind: "pr_no_task", guess: { task: { id: "t9" } } });
  });

  it("does not also call a guessed task 'task without PR'", () => {
    const { items } = run([pr({ title: "Add login page validation" })], [task({ id: "t9", name: "Login page validation" })]);
    expect(items.filter((i) => i.kind === "task_no_pr")).toEqual([]);
  });

  it("reports a task id that does not exist in ClickUp", () => {
    const { items } = run([pr({ taskIds: ["zzz"] })], []);
    expect(items[0]).toMatchObject({ kind: "pr_no_task", note: expect.stringContaining("zzz") });
  });

  it("reports in-progress tasks and recently finished tasks that no PR points at, but not backlog or old ones", () => {
    const { items } = run([], [
      task({ id: "a", name: "Working", status: "in progress" }),
      task({ id: "b", name: "Shipped", status: "complete", done: true, updated: "2026-10-15" }),
      task({ id: "c", name: "Ancient", status: "complete", done: true, updated: "2025-01-01" }),
      task({ id: "d", name: "Later", status: "to do", backlog: true }),
    ]);
    expect(items.map((i) => (i.kind === "task_no_pr" ? i.task.id : ""))).toEqual(["a", "b"]);
  });

  it("ignores PRs closed without merging", () => {
    expect(run([pr({ state: "closed" })], []).items).toEqual([]);
  });
});

describe("describeMeta", () => {
  it("names the engine, the data sources and a fallback", () => {
    const text = describeMeta({ engines: ["claude-local:sonnet", "gemini:gemini-3.8-flash"], fellBack: true, clickup: "mcp", github: true, tools: 3, ms: 4200 });
    expect(text).toBe("Answered by Claude (local) · sonnet → Gemini · 3.8-flash · backup engine used · data: ClickUp MCP (backup) + GitHub · 3 tools · 4.2s");
  });
  it("says so when no AI was involved", () => {
    expect(describeMeta({ engines: [], fellBack: false, clickup: "api", github: true, tools: 0, ms: 900 })).toContain("no AI");
  });
});
