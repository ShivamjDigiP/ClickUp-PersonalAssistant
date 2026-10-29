import { describe, expect, it } from "vitest";
import { flagImportedTasks } from "../lib/analytics/clean";
import { analyzeTeam, capabilityProfile } from "../lib/analytics/capability";
import { DAY, type Dataset, type TaskRec } from "../lib/analytics/types";

const NOW = Date.UTC(2026, 9, 26, 12);
const task = (i: number, createdAt: number, doneAt?: number, personId = "a"): TaskRec => ({ id: `t${i}`, personId, project: "P", title: "t", priority: "normal", stage: doneAt ? "done" : "doing", createdAt, doneAt, dueAt: createdAt + 3 * DAY });
const people = [{ id: "a", name: "A", level: "mid" as const, startDate: NOW - 200 * DAY }];

describe("import detection", () => {
  // a normal month: 2 tasks created and ~2 closed per day, plus a migration day with 140 created-and-closed at once
  const normal = Array.from({ length: 60 }, (_, i) => task(i, NOW - (30 - Math.floor(i / 2)) * DAY, NOW - (28 - Math.floor(i / 2)) * DAY));
  const importDay = NOW - 19 * DAY;
  const imported = Array.from({ length: 140 }, (_, i) => task(1000 + i, importDay - i * 1000, importDay + i * 1000));

  it("flags a migration day instead of removing it: every task stays, so totals match the task tool", () => {
    const out = flagImportedTasks({ people, tasks: [...normal, ...imported], commits: [], prs: [] });
    // the 140 imported, plus the 2 genuine tasks created on that same day: they cannot be told apart, so both are flagged
    expect(out.quality.importedTasks).toBe(142);
    expect(out.tasks).toHaveLength(200); // nothing removed
    expect(out.tasks.filter((t) => t.imported)).toHaveLength(142);
    expect(out.tasks.filter((t) => !t.imported)).toHaveLength(58);
    expect(out.quality.importDays).toEqual([new Date(importDay).toISOString().slice(0, 10)]);
  });

  it("keeps a busy release day: many closures, but not created-and-closed together", () => {
    const release = Array.from({ length: 40 }, (_, i) => task(2000 + i, NOW - (20 + (i % 10)) * DAY, NOW - 5 * DAY));
    const out = flagImportedTasks({ people, tasks: [...normal, ...release], commits: [], prs: [] });
    expect(out.quality.importedTasks).toBe(0);
  });

  it("changes nothing for ordinary data", () => {
    expect(flagImportedTasks({ people, tasks: normal, commits: [], prs: [] }).quality.importedTasks).toBe(0);
  });
});

describe("history needed before judging", () => {
  const make = (joinedDaysAgo: number, count: number): Dataset => ({
    people: [{ id: "a", name: "A", level: "mid", startDate: NOW - joinedDaysAgo * DAY }],
    tasks: Array.from({ length: count }, (_, i) => task(i, NOW - joinedDaysAgo * DAY + i, NOW - ((i * joinedDaysAgo) / count) * DAY)),
    commits: [],
    prs: [],
  });

  it("30 tasks in 2 weeks is not a track record: the history is marked as thin", () => {
    const ds = make(14, 30);
    expect(capabilityProfile(ds, ds.people[0], NOW).confidence).toBe("low");
    analyzeTeam(ds, NOW, 30);
  });

  it("the same output over 3 months is a solid track record", () => {
    const ds = make(90, 60);
    expect(capabilityProfile(ds, ds.people[0], NOW).confidence).toBe("high");
    expect(analyzeTeam(ds, NOW, 30)[0].profile.confidence).toBe("high");
  });
});
