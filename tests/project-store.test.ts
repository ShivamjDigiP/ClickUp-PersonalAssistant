import { describe, expect, it, vi } from "vitest";
import { nc, npr } from "./helpers";

async function fresh() {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  delete (globalThis as any).__platformDb;
  const store = await import("../lib/integrations/store");
  store.ensureWorkspace("w1", "One");
  store.ensureWorkspace("w2", "Two");
  return { projects: await import("../lib/platform/projects"), sync: await import("../lib/integrations/sync"), db: (await import("../lib/db")).db };
}
const NOW = Date.UTC(2026, 9, 26, 12);
const input = { name: "Shop", repos: [{ repo: "acme/shop-web", layer: "frontend" as const, part: "user" }, { repo: "acme/shop-api", layer: "backend" as const, part: null }], taskLists: ["Shop Sprint"] };

describe("project store", () => {
  it("saves a project with its repos (layer and part) and task lists, and reads it back", async () => {
    const { projects } = await fresh();
    const id = projects.saveProject("w1", projects.ProjectInput.parse(input))!;
    const [p] = projects.listProjectDefs("w1");
    expect(p).toMatchObject({ id, name: "Shop", taskLists: ["Shop Sprint"] });
    expect(p.repos).toEqual([{ repo: "acme/shop-api", layer: "backend", part: null }, { repo: "acme/shop-web", layer: "frontend", part: "user" }]);
  });

  it("editing replaces every source; names are unique per workspace regardless of case", async () => {
    const { projects } = await fresh();
    const id = projects.saveProject("w1", projects.ProjectInput.parse(input))!;
    projects.saveProject("w1", projects.ProjectInput.parse({ ...input, repos: [{ repo: "acme/shop-ios", layer: "mobile" }], taskLists: [] }), id);
    expect(projects.getProjectDef("w1", id)!.repos.map((r) => r.repo)).toEqual(["acme/shop-ios"]);
    expect(() => projects.saveProject("w1", projects.ProjectInput.parse({ ...input, name: "SHOP" }))).toThrow(/already exists/);
    expect(projects.saveProject("w2", projects.ProjectInput.parse(input))).toBeTruthy(); // same name in another workspace is fine
  });

  it("another workspace can neither see, change nor delete it", async () => {
    const { projects } = await fresh();
    const id = projects.saveProject("w1", projects.ProjectInput.parse(input))!;
    expect(projects.listProjectDefs("w2")).toEqual([]);
    expect(projects.saveProject("w2", projects.ProjectInput.parse(input), id)).toBeNull();
    expect(projects.deleteProject("w2", id)).toBe(false);
    expect(projects.deleteProject("w1", id)).toBe(true);
    expect(projects.listProjectDefs("w1")).toEqual([]);
  });

  it("rejects malformed repo names and unknown layers", async () => {
    const { projects } = await fresh();
    expect(projects.ProjectInput.safeParse({ ...input, repos: [{ repo: "../../etc/passwd", layer: "backend" }] }).success).toBe(false);
    expect(projects.ProjectInput.safeParse({ ...input, repos: [{ repo: "acme/x", layer: "database" }] }).success).toBe(false);
    expect(projects.ProjectInput.safeParse({ ...input, name: "  " }).success).toBe(false);
  });

  it("lists the repos and task lists that exist in the synced data", async () => {
    const { projects, sync } = await fresh();
    const a = { provider: "clickup" as const, externalId: "1", name: "Aria" };
    sync.saveBatch("w1", {
      people: [a], notes: [],
      tasks: [{ source: "clickup", externalId: "t1", assignee: a, project: "Shop Sprint", title: "t", priority: "normal", stage: "done", status: "complete", createdAt: NOW - 5, updatedAt: NOW }],
      commits: [nc({ repo: "acme/shop-web", sha: "1", at: NOW }), nc({ repo: "acme/shop-web", sha: "2", at: NOW })],
      prs: [npr({ repo: "acme/shop-api", number: 1, openedAt: NOW })],
    }, NOW);
    expect(projects.knownRepos("w1")).toEqual([{ repo: "acme/shop-web", commits: 2, prs: 0 }, { repo: "acme/shop-api", commits: 0, prs: 1 }]);
    expect(projects.knownTaskLists("w1")).toEqual([{ name: "Shop Sprint", source: "clickup", tasks: 1 }]);
    expect(projects.knownRepos("w2")).toEqual([]);
  });
});
