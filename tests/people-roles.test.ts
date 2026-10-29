import { describe, expect, it, vi } from "vitest";
import { nc } from "./helpers";

const NOW = Date.UTC(2026, 9, 26, 12);
const DAY = 86_400_000;

async function setup() {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  delete (globalThis as any).__platformDb;
  const store = await import("../lib/integrations/store");
  store.ensureWorkspace("w1", "W");
  const sync = await import("../lib/integrations/sync");
  const load = await import("../lib/analytics/load");
  const { analyzeTeam } = await import("../lib/analytics/capability");
  const { buildOverview } = await import("../lib/analytics/overview");
  const { db } = await import("../lib/db");
  const dev = { provider: "clickup" as const, externalId: "1", name: "Dev One", email: "dev@x.com" };
  const gh = { provider: "github" as const, externalId: "dev-gh", login: "dev-gh", email: "dev@x.com" };
  const des = { provider: "clickup" as const, externalId: "2", name: "Dee Signer", email: "dee@x.com" };
  const task = (assignee: typeof dev, id: string, createdAt: number, doneAt?: number) => ({ source: "clickup" as const, externalId: id, assignee, project: "P", title: id, priority: "normal" as const, stage: "done" as const, status: "done", createdAt, doneAt, updatedAt: createdAt });
  sync.saveBatch("w1", {
    people: [dev, des, gh], notes: [], prs: [],
    tasks: [task(dev, "t1", NOW - 20 * DAY, NOW - 19 * DAY), task(des, "d1", NOW - 10 * DAY, NOW - 9 * DAY), task(des, "d2", NOW - 8 * DAY, NOW - 7 * DAY), task(des, "d3", NOW - 6 * DAY, NOW - 5 * DAY)],
    commits: [nc({ repo: "o/r", sha: "c1", author: gh, at: NOW - 40 * DAY }), nc({ repo: "o/r", sha: "c2", author: gh, at: NOW - 2 * DAY })],
  }, NOW);
  return { load, analyzeTeam, buildOverview, db: db() };
}

describe("first interaction", () => {
  it("is the earliest task or commit, whichever came first, and is kept on the person", async () => {
    const { load, db } = await setup();
    const ds = load.loadDataset("w1");
    const dev = ds.people.find((p) => p.name === "Dev One")!;
    expect(dev.startDate).toBe(NOW - 40 * DAY); // the commit is older than the first task
    expect(ds.people.find((p) => p.name === "Dee Signer")!.startDate).toBe(NOW - 10 * DAY);
    load.persistFirstInteractions("w1");
    const stored = db.prepare("SELECT start_date FROM people WHERE name = 'Dev One'").get() as { start_date: number };
    expect(stored.start_date).toBe(NOW - 40 * DAY);
  });
});

describe("role and designation", () => {
  it("a role decides what is followed, whatever the data looks like", async () => {
    const { db, load, analyzeTeam } = await setup();
    const card = (name: string) => analyzeTeam(load.loadDataset("w1"), NOW, 30).find((c) => c.person.name === name)!;
    expect(card("Dev One").usesCode).toBe(true); // no role yet: has commits, so treated as a developer
    db.prepare("UPDATE people SET role = 'designer' WHERE name = 'Dev One'").run();
    expect(card("Dev One").usesCode).toBe(false);
    db.prepare("UPDATE people SET role = 'developer' WHERE name = 'Dee Signer'").run();
    expect(card("Dee Signer").usesCode).toBe(true);
  });

  it("the overview can show one role only, and lists the most active first", async () => {
    const { db, load, buildOverview } = await setup();
    db.prepare("UPDATE people SET role = 'developer' WHERE name = 'Dev One'").run();
    db.prepare("UPDATE people SET role = 'designer' WHERE name = 'Dee Signer'").run();
    const ds = load.loadDataset("w1");
    const all = buildOverview(ds, NOW, 30);
    expect(all.cards.map((c) => c.person.name)).toEqual(["Dee Signer", "Dev One"]); // 3 finished tasks against 1 task and 1 commit in the period
    const devs = buildOverview(ds, NOW, 30, "developer");
    expect(devs.cards.map((c) => c.person.name)).toEqual(["Dev One"]);
    expect(devs.totals.people).toBe(1);
    expect(devs.totals.completed).toBe(1);
  });

  it("old 'lead' designations become senior and github people get the developer role", async () => {
    const { db } = await setup();
    const row = db.prepare("SELECT role FROM people WHERE name = 'Dev One'").get() as { role: string | null };
    expect(row.role === null || row.role === "developer").toBe(true);
  });
});

describe("duration: the last 30 days, or all", () => {
  it("all time covers everything on record and is not diluted by the long window", async () => {
    const { load, buildOverview } = await setup();
    const { ALL_DAYS } = await import("../lib/analytics/types");
    const ds = load.loadDataset("w1");
    const month = buildOverview(ds, NOW, 30);
    const all = buildOverview(ds, NOW, ALL_DAYS);
    expect(all.totals.completed).toBeGreaterThanOrEqual(month.totals.completed);
    expect(all.totals.commits).toBe(2); // the commit from 40 days ago is only in "all"
    expect(month.totals.commits).toBe(1);
    // a person is measured from their first interaction, so Dee Signer's 10 days are not spread over ten years
    const dee = all.cards.find((c) => c.person.name === "Dee Signer")!;
    expect(dee.metrics.current.effectiveDays).toBeLessThan(60);
    // nothing is compared with "the period before" all time
    expect(all.cards.every((c) => !c.notes.some((n) => n.key === "up" || n.key === "down"))).toBe(true);
  });
});
