import { describe, expect, it } from "vitest";
import { seedDataset } from "../lib/analytics/seed";
import { personMetrics, periodMetrics } from "../lib/analytics/metrics";
import { analyzeTeam, capabilityProfile, capacityOver, forecastCompletion } from "../lib/analytics/capability";
import { DAY, type Dataset } from "../lib/analytics/types";

const NOW = Date.UTC(2026, 9, 26, 12);
const ds = seedDataset(NOW);
const by = (id: string) => ds.people.find((p) => p.id === id)!;

describe("metrics", () => {
  it("counts only what happened inside the period, on time and rework as shares", () => {
    const tiny: Dataset = {
      people: [{ id: "a", name: "A", level: "mid", startDate: 0 }],
      tasks: [
        { id: "1", personId: "a", project: "P", title: "t", priority: "urgent", stage: "done", createdAt: NOW - 9 * DAY, startedAt: NOW - 8 * DAY, doneAt: NOW - 6 * DAY, dueAt: NOW - 5 * DAY, reopened: 0 },
        { id: "2", personId: "a", project: "P", title: "t", priority: "low", stage: "done", createdAt: NOW - 9 * DAY, startedAt: NOW - 8 * DAY, doneAt: NOW - 2 * DAY, dueAt: NOW - 5 * DAY, reopened: 1 },
        { id: "3", personId: "a", project: "P", title: "t", priority: "normal", stage: "doing", createdAt: NOW - 3 * DAY, startedAt: NOW - 2 * DAY, dueAt: NOW - DAY, reopened: 0 },
      ],
      commits: [],
      prs: [],
    };
    const m = periodMetrics(tiny, "a", NOW - 30 * DAY, NOW);
    expect(m.completed).toBe(2);
    expect(m.completedPoints).toBe(5); // urgent 4 + low 1
    expect(m.onTimeRate).toBe(0.5);
    expect(m.reworkRate).toBe(0.5);
    expect(m.cycleDaysMedian).toBe(4); // median of 2 and 6 days
  });

  it("compares the period with the one before it", () => {
    const m = personMetrics(ds, "p-aria", NOW, 30);
    expect(m.current.completed).toBeGreaterThan(0);
    expect(m.previous.completed).toBeGreaterThan(0);
    expect(m.current.commits).toBeGreaterThan(m.previous.commits * 0.3);
  });
});

describe("capability", () => {
  it("weights a new joiner's prior heavily and their own history lightly", () => {
    const eli = capabilityProfile(ds, by("p-eli"), NOW);
    const aria = capabilityProfile(ds, by("p-aria"), NOW);
    expect(eli.weight).toBeLessThan(aria.weight);
    expect(aria.confidence).toBe("high");
  });

  it("forecast percentiles are ordered and the same input gives the same answer", () => {
    const f1 = forecastCompletion(ds, by("p-ben"), 12, NOW)!;
    const f2 = forecastCompletion(ds, by("p-ben"), 12, NOW)!;
    expect(f1).toEqual(f2);
    expect(f1.p50).toBeLessThanOrEqual(f1.p80);
    expect(f1.p80).toBeLessThanOrEqual(f1.p95);
    expect(f1.p50).toBeGreaterThan(NOW);
  });

  it("a stronger developer finishes the same work sooner and has more capacity", () => {
    const strong = forecastCompletion(ds, by("p-aria"), 20, NOW)!;
    const weak = forecastCompletion(ds, by("p-chen"), 20, NOW)!;
    expect(strong.p50).toBeLessThan(weak.p50);
    expect(capacityOver(ds, by("p-aria"), 14, NOW).likely).toBeGreaterThan(capacityOver(ds, by("p-chen"), 14, NOW).likely);
  });

  it("more tasks never finish sooner", () => {
    const a = forecastCompletion(ds, by("p-dara"), 5, NOW)!;
    const b = forecastCompletion(ds, by("p-dara"), 25, NOW)!;
    expect(b.p50).toBeGreaterThan(a.p50);
    expect(forecastCompletion(ds, by("p-dara"), 0, NOW)).toBeNull();
  });
});

describe("team analysis", () => {
  const cards = analyzeTeam(ds, NOW, 30);
  const card = (id: string) => cards.find((c) => c.person.id === id)!;

  it("carries facts only: no score, rank or verdict anywhere on a person", () => {
    for (const c of cards) {
      expect(Object.keys(c).sort()).toEqual(["completedDelta", "metrics", "notes", "person", "profile", "usesCode"]);
    }
    expect(JSON.stringify(cards)).not.toMatch(/exceeding|needs_support|on_track|"score"|"rank"/);
  });

  it("lists people alphabetically, which says nothing about anyone", () => {
    const names = cards.map((c) => c.person.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("says plainly when there is too little history for a pattern", () => {
    expect(card("p-eli").profile.confidence).not.toBe("high");
  });

  it("says what is going on in plain facts", () => {
    const chen = card("p-chen");
    expect(chen.notes.every((n) => typeof n.text === "string" && n.text.length > 0)).toBe(true);
    expect(chen.usesCode).toBe(card("p-chen").usesCode);
  });
});

describe("rates use the time a person has actually been around", () => {
  const joined = NOW - 10 * DAY;
  const newcomer: Dataset = {
    people: [{ id: "n", name: "New", level: "mid", startDate: joined }],
    tasks: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, personId: "n", project: "P", title: "t", priority: "normal" as const, stage: "done" as const, createdAt: joined + i * DAY, startedAt: joined + i * DAY, doneAt: joined + (i + 1) * DAY })),
    commits: [],
    prs: [],
  };

  it("a 10-day-old account is not measured over 90 days", () => {
    const m = personMetrics(newcomer, "n", NOW, 90).current;
    expect(m.effectiveDays).toBe(10);
    expect(m.throughputPerWeek).toBeCloseTo((6 / 10) * 7, 1); // about 4.2 a week, not 0.5
    expect(personMetrics(newcomer, "n", NOW, 30).current.throughputPerWeek).toBe(m.throughputPerWeek); // same answer whichever window is chosen
  });

  it("an established person is still measured over the whole window", () => {
    expect(personMetrics(ds, "p-aria", NOW, 90).current.effectiveDays).toBe(90);
  });
});

describe("the chosen period only changes the numbers shown", () => {
  it("but the numbers shown still follow the chosen period", () => {
    const aria = (days: 7 | 30) => analyzeTeam(ds, NOW, days).find((x) => x.person.id === "p-aria")!.metrics.current;
    expect(aria(7).days).toBe(7);
    expect(aria(7).completed).toBeLessThan(aria(30).completed);
  });
});
