import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeTeam } from "../lib/analytics/capability";
import { seedDataset } from "../lib/analytics/seed";

const NOW = Date.UTC(2026, 9, 26, 12);
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
beforeEach(() => vi.restoreAllMocks());

describe("what is going on", () => {
  const full = seedDataset(NOW);

  it("says things in plain facts, never as a grade", () => {
    const text = JSON.stringify(analyzeTeam(full, NOW, 30).map((c) => c.notes));
    expect(text).not.toMatch(/exceeding|needs support|on track|underperform|score|rank/i);
    expect(analyzeTeam(full, NOW, 30).some((c) => c.notes.length > 0)).toBe(true);
  });

  it("only mentions pull requests for people who have GitHub work", () => {
    const dev = analyzeTeam(full, NOW, 30).find((c) => c.usesCode)!;
    const noCode = { ...full, people: full.people.map((p) => (p.id === dev.person.id ? { ...p, role: "designer" as const } : p)), commits: full.commits.filter((c) => c.personId !== dev.person.id), prs: full.prs.filter((p) => p.personId !== dev.person.id) };
    const asDesigner = analyzeTeam(noCode, NOW, 30).find((c) => c.person.id === dev.person.id)!;
    expect(asDesigner.usesCode).toBe(false);
    expect(asDesigner.notes.some((n) => n.key === "prs")).toBe(false);
  });
});

async function fresh() {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  delete (globalThis as any).__platformDb;
  const store = await import("../lib/integrations/store");
  store.ensureWorkspace("w1", "W");
  store.ensureWorkspace("w2", "Other");
  return { store, github: await import("../lib/integrations/github") };
}

const repo = (name: string, extra: Record<string, unknown> = {}) => ({ full_name: name, private: false, archived: false, fork: false, pushed_at: new Date(NOW).toISOString(), ...extra });

describe("choosing GitHub repositories", () => {
  it("lists every repository the token can read, following pages, for an organisation", async () => {
    const { github } = await fresh();
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      calls.push(`${url.pathname}?page=${url.searchParams.get("page")}`);
      const page = Number(url.searchParams.get("page"));
      return json(page === 1 ? Array.from({ length: 100 }, (_, i) => repo(`org/r${i}`)) : [repo("org/last", { archived: true, private: true })]);
    });
    const out = await github.listAccessibleRepos("ghp_secret123", "org");
    expect(out).toHaveLength(101);
    expect(calls).toEqual(["/orgs/org/repos?page=1", "/orgs/org/repos?page=2"]);
    expect(out[100]).toMatchObject({ name: "org/last", archived: true, private: true });
  });

  it("without an organisation it lists the user's own repositories", async () => {
    const { github } = await fresh();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json([repo("me/one", { fork: true, pushed_at: null })]));
    const out = await github.listAccessibleRepos("ghp_secret123");
    expect(String(spy.mock.calls[0][0])).toContain("/user/repos");
    expect(out).toEqual([{ name: "me/one", private: false, archived: false, fork: true, pushedAt: null }]);
  });

  it("saving a choice keeps the rest of the configuration, removes duplicates, and refuses other workspaces and other tools", async () => {
    const { store } = await fresh();
    const id = store.saveIntegration({ workspaceId: "w1", provider: "github", label: "GH", config: { org: "org", excludeMergeCommits: false }, secret: "ghp_abcdefgh" });
    expect(store.updateIntegrationConfig(id, "w1", { repos: ["org/a", "org/b", "org/a"] })).toBe(true);
    expect(store.listIntegrations("w1")[0].config).toEqual({ org: "org", excludeMergeCommits: false, repos: ["org/a", "org/b"] });
    expect(store.updateIntegrationConfig(id, "w2", { repos: ["org/a"] })).toBe(false);
    const cu = store.saveIntegration({ workspaceId: "w1", provider: "clickup", label: "CU", config: {}, secret: "pk_secret_token" });
    expect(store.updateIntegrationConfig(cu, "w1", { repos: ["org/a"] })).toBe(false);
  });

  it("a sync reads exactly the chosen repositories and no others", async () => {
    const { github } = await fresh();
    const repos = await github.listRepos("ghp_secret123", { org: "org", repos: ["org/a", "org/b"] }, 0);
    expect(repos).toEqual(["org/a", "org/b"]);
  });
});
