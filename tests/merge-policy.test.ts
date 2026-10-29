import { describe, expect, it, vi } from "vitest";
import { nc } from "./helpers";

const NOW = Date.UTC(2026, 9, 26, 12);
const DAY = 86_400_000;

// A developer with real commits and merge commits in two repositories.
async function setup(config: Record<string, unknown> | null = {}) {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  delete (globalThis as any).__platformDb;
  const store = await import("../lib/integrations/store");
  store.ensureWorkspace("w1", "W");
  store.ensureWorkspace("w2", "Other");
  const sync = await import("../lib/integrations/sync");
  const { loadDataset } = await import("../lib/analytics/load");
  const { personWork } = await import("../lib/analytics/personWork");
  const { buildOverview } = await import("../lib/analytics/overview");
  const dev = { provider: "clickup" as const, externalId: "1", name: "Dev One", email: "dev@x.com" };
  const gh = { provider: "github" as const, externalId: "dev-gh", login: "dev-gh", email: "dev@x.com" };
  const c = (sha: string, repo: string, message: string, extra: Record<string, unknown> = {}) => nc({ repo, sha, author: gh, at: NOW - DAY, message, ...extra });
  sync.saveBatch("w1", {
    people: [dev], tasks: [], notes: [], prs: [],
    commits: [
      c("1", "org/web", "feat: add reports"), c("2", "org/web", "fix: chart colours"),
      c("3", "org/web", "Merge branch 'develop' into dev-one"), c("4", "org/api", "Merge pull request #12 from org/dev-one"),
      c("5", "org/api", "Add invite emails"), c("6", "org/api", "Combine histories", { parents: 2 }), // a merge by structure, not by its message
    ],
  }, NOW);
  const id = config === null ? null : store.saveIntegration({ workspaceId: "w1", provider: "github", label: "GitHub", config, secret: "ghp_abcdefgh" });
  const counts = () => {
    const ds = loadDataset("w1");
    const w = personWork(ds, ds.people[0].id, [], NOW, 30).code;
    return { dataset: ds.commits.length, commits: w.commits, mergeCommits: w.mergeCommits, overview: buildOverview(ds, NOW, 30).totals.commits, list: w.commitItems.length };
  };
  return { store, sync, id, counts, db: (await import("../lib/db")).db };
}

describe("merge commits are left out by default, everywhere", () => {
  it("with no setting at all, only the commits somebody wrote are counted, listed and charted", async () => {
    const { counts } = await setup(null); // no GitHub integration on record
    expect(counts()).toEqual({ dataset: 3, commits: 3, mergeCommits: 0, overview: 3, list: 3 });
  });

  it("a connected GitHub integration defaults to excluding them", async () => {
    const { counts } = await setup({ org: "org" });
    expect(counts().commits).toBe(3);
  });

  it("detects a merge by its message and by having two parents", async () => {
    const { counts } = await setup({});
    expect(counts().mergeCommits).toBe(0);
    expect(counts().dataset).toBe(3); // 6 stored, 3 merges removed: 'Merge branch', 'Merge pull request', and the two-parent one
  });
});

describe("unticking the setting brings merge commits back", () => {
  it("through the whole platform at once, with no re-sync", async () => {
    const { counts, store, id } = await setup({ org: "org" });
    expect(counts().commits).toBe(3);
    expect(store.updateIntegrationConfig(id!, "w1", { excludeMergeCommits: false })).toBe(true);
    expect(counts()).toEqual({ dataset: 6, commits: 6, mergeCommits: 3, overview: 6, list: 6 });
    store.updateIntegrationConfig(id!, "w1", { excludeMergeCommits: true });
    expect(counts().commits).toBe(3);
  });

  it("only for the repositories that integration covers", async () => {
    const { counts, sync, id } = await setup({ org: "org", excludeMergeCommits: false });
    sync.pruneUncoveredRepos("w1", id!, ["org/web"]); // its last full sync covered only org/web (this also drops org/api rows)
    const c = counts();
    expect(c.mergeCommits).toBe(1); // org/web's merge shows; org/api is no longer covered
    expect(c.commits).toBe(3);
  });

  it("an integration that has not recorded its repositories yet applies its setting to all of them", async () => {
    const { counts } = await setup({ excludeMergeCommits: false });
    expect(counts().mergeCommits).toBe(3);
  });

  it("another integration left on the default does not hide what this one shows", async () => {
    const { counts, store } = await setup({ excludeMergeCommits: false });
    store.saveIntegration({ workspaceId: "w1", provider: "github", label: "Second org", config: {}, secret: "ghp_zzzzzzzz" });
    expect(counts().mergeCommits).toBe(3);
  });
});

describe("changing the setting", () => {
  it("keeps the rest of the configuration (organisation, repositories) and never touches the token", async () => {
    const { store, id, db } = await setup({ org: "org", maxRepos: 12, excludeMergeCommits: true });
    const before = (db().prepare("SELECT secret FROM integrations WHERE id = ?").get(id) as any).secret;
    store.updateIntegrationConfig(id!, "w1", { excludeMergeCommits: false });
    const row = store.listIntegrations("w1")[0];
    expect(row.config).toEqual({ org: "org", maxRepos: 12, excludeMergeCommits: false });
    expect((db().prepare("SELECT secret FROM integrations WHERE id = ?").get(id) as any).secret).toBe(before);
  });

  it("refuses another workspace's integration, an unknown one, and a tool that has no merge commits", async () => {
    const { store, id } = await setup({});
    expect(store.updateIntegrationConfig(id!, "w2", { excludeMergeCommits: false })).toBe(false);
    expect(store.updateIntegrationConfig("nope", "w1", { excludeMergeCommits: false })).toBe(false);
    const cu = store.saveIntegration({ workspaceId: "w1", provider: "clickup", label: "ClickUp", config: {}, secret: "pk_secret_token" });
    expect(store.updateIntegrationConfig(cu, "w1", { excludeMergeCommits: false })).toBe(false);
  });
});
