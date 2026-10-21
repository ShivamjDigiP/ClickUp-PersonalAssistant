import { describe, expect, it } from "vitest";
import { DAY, EMPTY, activeCount, flagsOf, fromParams, matches, sortTasks, toParams, type PTask } from "../lib/projectFilters";
import { assignSlugs, slugify } from "../lib/slug";

const now = Date.UTC(2026, 9, 21);
const t = (over: Partial<PTask>): PTask => ({
  id: "1",
  name: "Task",
  url: "",
  status: "backlog",
  stage: "backlog",
  assignees: [{ id: 1, name: "Asha" }],
  priority: "normal",
  due: null,
  created: now - 30 * DAY,
  updated: now - DAY,
  closed: null,
  ...over,
});

describe("project filters", () => {
  const tasks = [
    t({ id: "a", status: "backlog", assignees: [{ id: 1, name: "Asha" }] }),
    t({ id: "b", status: "backlog", assignees: [{ id: 2, name: "Ravi" }], due: now - DAY }),
    t({ id: "c", status: "in review", stage: "progress", assignees: [] }),
    t({ id: "d", status: "completed", stage: "done", assignees: [{ id: 1, name: "Asha" }], due: now - DAY }),
  ];
  const ids = (f: Partial<typeof EMPTY>, skip?: Parameters<typeof matches>[3]) =>
    tasks.filter((x) => matches(x, { ...EMPTY, ...f }, now, skip)).map((x) => x.id);

  it("no filters matches everything", () => expect(ids({})).toEqual(["a", "b", "c", "d"]));
  it("values inside one filter are OR", () => expect(ids({ statuses: ["backlog", "in review"] })).toEqual(["a", "b", "c"]));
  it("different filters are AND (backlog + a person)", () => expect(ids({ statuses: ["backlog"], people: ["2"] })).toEqual(["b"]));
  it("'none' finds unassigned tasks", () => expect(ids({ people: ["none"] })).toEqual(["c"]));
  it("overdue only counts open tasks", () => expect(ids({ flags: ["overdue"] })).toEqual(["b"]));
  it("search matches name, status and assignee", () => {
    expect(ids({ q: "ravi" })).toEqual(["b"]);
    expect(ids({ q: "review" })).toEqual(["c"]);
  });
  it("skip leaves one filter out, for facet counts", () => {
    expect(ids({ statuses: ["backlog"], people: ["2"] }, "statuses")).toEqual(["b"]);
    expect(ids({ statuses: ["backlog"] }, "statuses")).toEqual(["a", "b", "c", "d"]);
  });
  it("counts active filters and reset is the empty state", () => {
    expect(activeCount({ ...EMPTY, statuses: ["x"], people: ["1", "2"], q: " hi " })).toBe(4);
    expect(activeCount(EMPTY)).toBe(0);
  });
  it("flags: overdue, soon, stale", () => {
    expect(flagsOf(t({ due: now - DAY }), now)).toContain("overdue");
    expect(flagsOf(t({ due: now + 2 * DAY }), now)).toContain("soon");
    expect(flagsOf(t({ updated: now - 9 * DAY }), now)).toContain("stale");
    expect(flagsOf(t({ stage: "done", due: now - DAY }), now)).toEqual([]);
  });
  it("sorts open work first by due date", () => {
    expect(sortTasks(tasks, "due").map((x) => x.id)).toEqual(["b", "a", "c", "d"]);
  });
  it("round-trips through URL params", () => {
    const f = { ...EMPTY, q: "x", statuses: ["backlog", "in review"], people: ["2", "none"], stages: ["backlog" as const], sort: "priority" as const };
    expect(fromParams(toParams(f))).toEqual(f);
    expect(fromParams(new URLSearchParams("stage=bogus&sort=bogus")).stages).toEqual([]);
  });
});

describe("slugs", () => {
  it("slugifies names", () => {
    expect(slugify("Imported from Jira")).toBe("imported-from-jira");
    expect(slugify("Screen 5 - Create Campaign: Schedule (Step 4)")).toBe("screen-5-create-campaign-schedule-step-4");
    expect(slugify("  ")).toBe("project");
  });
  it("keeps duplicate names distinct and stable", () => {
    const m = assignSlugs([{ id: "2", name: "Bugs" }, { id: "1", name: "Bugs" }, { id: "3", name: "Features" }]);
    expect(m.get("1")).toBe("bugs");
    expect(m.get("2")).toBe("bugs-2");
    expect(m.get("3")).toBe("features");
  });
});
