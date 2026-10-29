import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.UTC(2026, 9, 26, 12);
const DAY = 86_400_000;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

// Each test gets a fresh in-memory database and fresh modules.
async function fresh() {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  delete (globalThis as any).__platformDb;
  delete process.env.AUTH_SECRET;
  const store = await import("../lib/integrations/store");
  store.ensureWorkspace();
  return { store, sync: await import("../lib/integrations/sync"), load: await import("../lib/analytics/load"), db: (await import("../lib/db")).db };
}

const route = (table: Record<string, (url: URL, init?: RequestInit) => Response>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const key = Object.keys(table).find((k) => `${url.host}${url.pathname}`.startsWith(k));
    if (!key) throw new Error(`unexpected request ${url}`);
    return table[key](url, init);
  });

beforeEach(() => vi.restoreAllMocks());

// ---- ClickUp ------------------------------------------------------------------------------------------------------
const cuTask = (over: any = {}) => ({
  id: "abc1", name: "Build login", date_created: String(NOW - 10 * DAY), date_updated: String(NOW - DAY), due_date: String(NOW - 3 * DAY),
  status: { status: "in review", type: "custom" }, priority: { priority: "high" }, list: { name: "Mobile" }, url: "https://app.clickup.com/t/abc1",
  assignees: [{ id: 11, username: "Aria Shah", email: "aria@acme.com" }], ...over,
});

describe("ClickUp adapter", () => {
  it("maps tasks per assignee, skips unassigned, and leaves rework unknown", async () => {
    const { clickupAdapter } = await import("../lib/integrations/clickup");
    route({
      "api.clickup.com/api/v2/team/1/task": (url) => json({ last_page: true, tasks: url.searchParams.get("include_closed") === "true" ? [cuTask({ id: "d1", status: { status: "complete", type: "closed" }, date_done: String(NOW - 2 * DAY), assignees: [{ id: 11, username: "Aria Shah" }, { id: 12, username: "Ben Carter" }] }), cuTask({ id: "x", assignees: [] }), cuTask({ id: "sub", parent: "abc1" })] : [cuTask()] }),
      "api.clickup.com/api/v2/task/bulk_time_in_status": () => json({ d1: { status_history: [{ status: "to do", total_time: { since: String(NOW - 9 * DAY) } }, { status: "in development", total_time: { since: String(NOW - 6 * DAY) } }] } }),
      "api.clickup.com/api/v2/team": () => json({ teams: [{ id: "1", name: "Acme", members: [{ user: { id: 11, username: "Aria Shah", email: "ARIA@acme.com" } }, { user: { id: 13, username: "Zed No Tasks" } }] }] }),
    });
    const b = await clickupAdapter.sync({}, "tok", { since: NOW - 30 * DAY, now: NOW });
    expect(b.people.map((p) => p.name)).toEqual(["Aria Shah", "Zed No Tasks"]);
    expect(b.people[0].email).toBe("aria@acme.com");
    const done = b.tasks.filter((t) => t.externalId === "d1");
    expect(done).toHaveLength(2); // two assignees
    expect(done[0]).toMatchObject({ stage: "done", doneAt: NOW - 2 * DAY, startedAt: NOW - 6 * DAY, reopened: undefined });
    expect(b.tasks.find((t) => t.externalId === "abc1")).toMatchObject({ stage: "review", status: "in review", priority: "high", project: "Mobile" });
    expect(done[0]).toMatchObject({ status: "complete", parent: undefined });
    expect(b.tasks.find((t) => t.externalId === "x")).toBeUndefined();
    expect(b.tasks.find((t) => t.externalId === "sub")).toMatchObject({ parent: "abc1" });
  });

  it("still returns tasks, with a note, when start times are unavailable", async () => {
    const { clickupAdapter } = await import("../lib/integrations/clickup");
    route({
      "api.clickup.com/api/v2/team/1/task": () => json({ last_page: true, tasks: [cuTask({ id: "d1", status: { status: "complete", type: "closed" } })] }),
      "api.clickup.com/api/v2/task/bulk_time_in_status": () => json({ err: "ClickApp disabled" }, 400),
      "api.clickup.com/api/v2/team": () => json({ teams: [{ id: "1", name: "Acme", members: [] }] }),
    });
    const b = await clickupAdapter.sync({}, "tok", { since: NOW - 30 * DAY, now: NOW });
    expect(b.tasks[0].startedAt).toBeUndefined();
    expect(b.notes.join(" ")).toMatch(/start times unavailable/);
  });

  it("reports a rejected token without echoing it", async () => {
    const { clickupAdapter } = await import("../lib/integrations/clickup");
    route({ "api.clickup.com/api/v2/user": () => json({ err: "Token invalid" }, 401) });
    const r = await clickupAdapter.validate({}, "pk_secret_value");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("pk_secret_value");
    expect((r as any).error).toMatch(/rejected/);
  });
});

// ---- GitHub -------------------------------------------------------------------------------------------------------
const when = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const gcommit = (oid: string, login: string | null, email = "x@y.com", extra: Record<string, unknown> = {}) => ({
  oid, authoredDate: when(1), messageHeadline: "work", changedFilesIfAvailable: 3, additions: 10, deletions: 4, parents: { totalCount: 1 },
  author: { email, name: "N", user: login ? { login } : null }, ...extra,
});
const gpr = (n: number, extra: Record<string, unknown> = {}, commits: any[] = []) => ({
  number: n, title: `PR ${n}`, body: "- did a\n- did b", state: "MERGED", createdAt: when(3), updatedAt: when(1), mergedAt: when(1), baseRefName: "develop", headRefName: "feat/x",
  changedFiles: 5, additions: 1, deletions: 1, labels: { nodes: [] }, author: { login: "aria" }, reviews: { nodes: [{ state: "APPROVED", submittedAt: when(2) }] },
  commits: { totalCount: commits.length, nodes: commits.map((commit) => ({ commit })) }, ...extra,
});
const prPage = (nodes: any[], hasNext = false) => ({ data: { repository: { defaultBranchRef: { name: "main" }, pullRequests: { pageInfo: { hasNextPage: hasNext, endCursor: "c" }, nodes } } } });
const branchPage = (nodes: any[]) => ({ data: { repository: { ref: { target: { history: { pageInfo: { hasNextPage: false }, nodes } } } } } });

describe("GitHub adapter", () => {
  const orgRepos = [{ full_name: "acme/app", pushed_at: when(1) }, { full_name: "acme/broken", pushed_at: when(1) }, { full_name: "acme/old", pushed_at: when(400) }, { full_name: "acme/arch", archived: true, pushed_at: when(0) }];

  it("finds commits on PR branches, not just the default branch (the bug that showed 70 commits for 546 PRs)", async () => {
    const { githubAdapter } = await import("../lib/integrations/github");
    const requested: string[] = [];
    route({
      "api.github.com/orgs/acme/repos": () => json(orgRepos),
      "api.github.com/graphql": (_u, init) => {
        const { query, variables } = JSON.parse(String(init!.body));
        if (variables.name === "broken") return json({ errors: [{ message: "Could not resolve to a Repository" }] });
        if (String(query).includes("pullRequests")) {
          return json(prPage([gpr(7, {}, [
            gcommit("p7a", "aria", "aria@acme.com", { messageHeadline: "CU-abc123def fix login" }),
            gcommit("p7b", null, "99+ben@users.noreply.github.com"),
            gcommit("p7c", "dependabot[bot]"),
            gcommit("p7d", null, "stranger@x.com"),
            gcommit("old", "aria", "aria@acme.com", { authoredDate: when(200) }), // carried by the PR but written long before the window
          ])]));
        }
        requested.push(variables.ref);
        if (variables.ref === "refs/heads/develop") {
          return json(branchPage([
            { ...gcommit("p7a", "aria"), associatedPullRequests: { totalCount: 1 } }, // belongs to PR 7: already counted
            { ...gcommit("direct1", "aria", "aria@acme.com", { messageHeadline: "hotfix: patch config" }), associatedPullRequests: { totalCount: 0 } }, // a direct push
            { ...gcommit("merge1", "aria", "aria@acme.com", { messageHeadline: "Merge branch x", parents: { totalCount: 2 } }), associatedPullRequests: { totalCount: 0 } },
          ]));
        }
        return json(branchPage([])); // the default branch is quiet, as in the real repositories
      },
    });
    const b = await githubAdapter.sync({ org: "acme" }, "tok", { since: NOW - 30 * DAY, now: NOW });
    expect(requested.sort()).toEqual(["refs/heads/develop", "refs/heads/main"]); // default branch AND the branch PRs merge into
    expect(b.commits.map((c) => c.sha).sort()).toEqual(["direct1", "merge1", "p7a", "p7b", "p7c", "p7d"]); // each commit once; the old one is outside the window
    const by = Object.fromEntries(b.commits.map((c) => [c.sha, c]));
    expect(by.p7a).toMatchObject({ prNumber: 7, message: "CU-abc123def fix login", taskRef: "abc123def", filesChanged: 3 });
    expect(by.p7a.author?.login).toBe("aria");
    expect(by.p7b.author?.login).toBe("ben"); // resolved from the noreply address
    expect(by.p7c.author).toBeNull(); // a bot is not a person
    expect(by.p7d.author).toBeNull(); // no GitHub account to attribute to: not guessed
    expect(by.direct1.prNumber).toBeUndefined();
    expect(by.merge1.parents).toBe(2);
    expect(b.notes.join(" ")).toMatch(/acme\/broken skipped/);
    expect(b.commits.every((c) => c.repo === "acme/app")).toBe(true); // old and archived repos are not read
  });

  it("reads how each pull request went: state, size, review rounds and who reviewed it", async () => {
    const { githubAdapter } = await import("../lib/integrations/github");
    route({
      "api.github.com/orgs/acme/repos": () => json([orgRepos[0]]),
      "api.github.com/graphql": (_u, init) => {
        const { query } = JSON.parse(String(init!.body));
        if (!String(query).includes("pullRequests")) return json(branchPage([]));
        return json(prPage([
          gpr(1, { reviews: { nodes: [{ state: "CHANGES_REQUESTED", submittedAt: when(2.5) }, { state: "COMMENTED", submittedAt: when(2.2) }, { state: "APPROVED", submittedAt: when(2) }, { state: "PENDING", submittedAt: null }] }, labels: { nodes: [{ name: "bug" }] } }, [gcommit("a", "aria"), gcommit("b", "aria")]),
          gpr(2, { reviews: { nodes: [] }, state: "OPEN", mergedAt: null }),
          gpr(3, { state: "CLOSED", mergedAt: null, body: null }),
        ]));
      },
    });
    const b = await githubAdapter.sync({ org: "acme" }, "tok", { since: NOW - 30 * DAY, now: NOW });
    const [p1, p2, p3] = b.prs;
    expect(p1).toMatchObject({ number: 1, state: "merged", baseBranch: "develop", reviewRounds: 1, approvals: 1, reviewed: true, changelogItems: 2, filesChanged: 5, commitCount: 2, labels: ["bug"], firstReviewAt: NOW - 2.5 * DAY });
    expect(p2).toMatchObject({ state: "open", reviewed: false, reviewRounds: 0 });
    expect(p3).toMatchObject({ state: "closed", changelogItems: 0 });
  });

  it("reads every commit of a long-running pull request, not just the first 100", async () => {
    const { githubAdapter } = await import("../lib/integrations/github");
    const mk = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ commit: gcommit(`long${from + i}`, "aria") }));
    let moreCalls = 0;
    route({
      "api.github.com/orgs/acme/repos": () => json([orgRepos[0]]),
      "api.github.com/graphql": (_u, init) => {
        const { query, variables } = JSON.parse(String(init!.body));
        if (String(query).includes("pullRequest(number")) {
          moreCalls++;
          expect(variables.after).toBe("cursor-100");
          return json({ data: { repository: { pullRequest: { commits: { pageInfo: { hasNextPage: false }, nodes: mk(100, 202) } } } } });
        }
        if (!String(query).includes("pullRequests")) return json(branchPage([]));
        const long = gpr(9, {}, []);
        return json(prPage([{ ...long, commits: { totalCount: 202, pageInfo: { hasNextPage: true, endCursor: "cursor-100" }, nodes: mk(0, 100) } }]));
      },
    });
    const b = await githubAdapter.sync({ org: "acme" }, "tok", { since: NOW - 30 * DAY, now: NOW });
    expect(moreCalls).toBe(1);
    expect(b.commits).toHaveLength(202);
    expect(b.prs[0].commitCount).toBe(202);
    expect(b.notes.join(" ")).not.toMatch(/only the first/);
  });

  it("keeps reading pull request pages until it reaches ones older than the sync window", async () => {
    const { githubAdapter } = await import("../lib/integrations/github");
    const pages = [
      prPage([gpr(1), gpr(2)], true),
      prPage([gpr(3, { updatedAt: when(5) }), gpr(4, { updatedAt: when(20) })], true),
      prPage([gpr(5, { updatedAt: when(60) }), gpr(6, { updatedAt: when(70) })], true), // older than the window: stop here
      prPage([gpr(7, { updatedAt: when(90) })]), // must never be requested
    ];
    let prCalls = 0;
    route({
      "api.github.com/orgs/acme/repos": () => json([orgRepos[0]]),
      "api.github.com/graphql": (_u, init) => {
        const { query } = JSON.parse(String(init!.body));
        return String(query).includes("pullRequests") ? json(pages[prCalls++]) : json(branchPage([]));
      },
    });
    const b = await githubAdapter.sync({ org: "acme" }, "tok", { since: NOW - 30 * DAY, now: NOW });
    expect(prCalls).toBe(3);
    expect(b.prs.map((p) => p.number)).toEqual([1, 2, 3, 4]); // 5 and 6 were read but are outside the window
  });
});

// ---- Jira ---------------------------------------------------------------------------------------------------------
describe("Jira adapter", () => {
  const issue = {
    id: "1", key: "ABC-12",
    fields: { summary: "Fix payments", created: new Date(NOW - 20 * DAY).toISOString(), updated: new Date(NOW - DAY).toISOString(), duedate: "2026-10-20", resolutiondate: new Date(NOW - 2 * DAY).toISOString(), status: { name: "Done", statusCategory: { key: "done" } }, priority: { name: "Highest" }, project: { name: "Payments" }, assignee: { accountId: "acc-1", displayName: "Ben Carter", emailAddress: "Ben@acme.com" } },
    changelog: { histories: [
      { created: new Date(NOW - 15 * DAY).toISOString(), items: [{ field: "status", fromString: "To Do", toString: "In Progress" }] },
      { created: new Date(NOW - 10 * DAY).toISOString(), items: [{ field: "status", fromString: "In Progress", toString: "Done" }] },
      { created: new Date(NOW - 8 * DAY).toISOString(), items: [{ field: "status", fromString: "Done", toString: "In Progress" }] },
      { created: new Date(NOW - 2 * DAY).toISOString(), items: [{ field: "status", fromString: "In Progress", toString: "Done" }] },
    ] },
  };

  it("reads start time, reopen count, priority and done date from the issue history", async () => {
    const { jiraAdapter } = await import("../lib/integrations/jira");
    const spy = route({ "acme.atlassian.net/rest/api/3/search/jql": () => json({ issues: [issue, { ...issue, key: "ABC-13", fields: { ...issue.fields, assignee: null } }] }) });
    const b = await jiraAdapter.sync({ site: "https://Acme.atlassian.net/", email: "me@acme.com" }, "tok", { since: NOW - 30 * DAY, now: NOW });
    expect(b.tasks).toHaveLength(1); // unassigned skipped
    expect(b.tasks[0]).toMatchObject({ externalId: "ABC-12", priority: "urgent", stage: "done", reopened: 1, startedAt: NOW - 15 * DAY, doneAt: NOW - 2 * DAY, project: "Payments" });
    expect(b.tasks[0].assignee.email).toBe("ben@acme.com");
    expect(String(spy.mock.calls[0][1]?.headers && JSON.stringify(spy.mock.calls[0][1]!.headers))).toContain("Basic ");
  });

  it("refuses sites that are not on atlassian.net (the host becomes a server-side request)", async () => {
    const { jiraAdapter } = await import("../lib/integrations/jira");
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await jiraAdapter.validate({ site: "169.254.169.254", email: "a@b.c" }, "t");
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---- identity, sync, dataset ---------------------------------------------------------------------------------------
describe("sync", () => {
  const person = (provider: any, externalId: string, name?: string, email?: string, login?: string) => ({ provider, externalId, name, email, login });
  const task = (externalId: string, assignee: any, over: any = {}) => ({ source: "clickup" as const, externalId, assignee, project: "P", title: "t", priority: "normal" as const, stage: "done" as const, createdAt: NOW - 12 * DAY, doneAt: NOW - 3 * DAY, dueAt: NOW - 2 * DAY, updatedAt: NOW, ...over });

  it("links one developer across ClickUp and GitHub by e-mail or name, and leaves strangers unlinked", async () => {
    const { sync, load, db } = await fresh();
    const aria = person("clickup", "11", "Aria Shah", "aria@acme.com");
    sync.saveBatch("ws_default", { people: [aria], tasks: [task("t1", aria)], commits: [], prs: [], notes: [] }, NOW);
    sync.saveBatch("ws_default", {
      people: [], tasks: [], notes: [], prs: [],
      commits: [
        { repo: "acme/app", sha: "a", author: person("github", "ariaS", "A S", "aria@acme.com", "ariaS"), at: NOW - DAY, additions: 5, deletions: 1, message: "feat: work" }, // same e-mail
        { repo: "acme/app", sha: "b", author: person("github", "ben-gh", "Ben Carter", undefined, "ben-gh"), at: NOW - DAY, additions: 2, deletions: 2, message: "feat: work" }, // nobody called Ben yet
        { repo: "acme/app", sha: "c", author: person("github", "ghost", "Someone Else", undefined, "ghost"), at: NOW - DAY, additions: 9, deletions: 9, message: "feat: work" },
      ],
    }, NOW);
    expect((db().prepare("SELECT count(*) c FROM people").get() as any).c).toBe(1); // GitHub never creates people
    const ds = load.loadDataset("ws_default");
    expect(ds.commits).toHaveLength(1); // only Aria's: the others are unlinked
    expect(ds.commits[0].personId).toBe(ds.people[0].id);
    expect(load.unlinkedAccounts("ws_default").map((u) => u.externalId).sort()).toEqual(["ben-gh", "ghost"]);
  });

  it("is idempotent: syncing the same batch twice changes nothing", async () => {
    const { sync, db } = await fresh();
    const a = person("clickup", "11", "Aria Shah", "aria@acme.com");
    const batch = { people: [a], tasks: [task("t1", a), task("t2", a)], commits: [{ repo: "r", sha: "s1", author: null, at: NOW, additions: 1, deletions: 1, message: "feat: work" }], prs: [], notes: [] };
    sync.saveBatch("ws_default", batch, NOW);
    sync.saveBatch("ws_default", batch, NOW + 1000);
    const n = (t: string) => (db().prepare(`SELECT count(*) c FROM ${t}`).get() as any).c;
    expect([n("tasks"), n("commits"), n("people"), n("identities")]).toEqual([2, 1, 1, 1]);
  });

  it("drops the row of someone who was un-assigned, and keeps a known start time when a later sync cannot see it", async () => {
    const { sync, db } = await fresh();
    const a = person("clickup", "11", "Aria Shah"), b = person("clickup", "12", "Ben Carter");
    sync.saveBatch("ws_default", { people: [a, b], tasks: [task("t1", a, { startedAt: NOW - 5 * DAY }), task("t1", b)], commits: [], prs: [], notes: [] }, NOW);
    sync.saveBatch("ws_default", { people: [], tasks: [task("t1", a, { startedAt: undefined })], commits: [], prs: [], notes: [] }, NOW);
    const rows = db().prepare("SELECT started_at FROM tasks").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].started_at).toBe(NOW - 5 * DAY);
  });

  it("rolls back the whole batch when something fails mid-way", async () => {
    const { sync, db } = await fresh();
    const a = person("clickup", "11", "Aria Shah");
    expect(() => sync.saveBatch("ws_default", { people: [a], tasks: [task("t1", a), { ...task("t2", a), createdAt: undefined as any }], commits: [], prs: [], notes: [] }, NOW)).toThrow();
    expect((db().prepare("SELECT count(*) c FROM tasks").get() as any).c).toBe(0);
    expect((db().prepare("SELECT count(*) c FROM people").get() as any).c).toBe(0);
  });

  it("feeds the analysis: loaded data produces a scored card for a person with real history", async () => {
    const { sync, load } = await fresh();
    const { analyzeTeam } = await import("../lib/analytics/capability");
    const a = person("clickup", "11", "Aria Shah", "aria@acme.com");
    const tasks = Array.from({ length: 30 }, (_, i) => task(`t${i}`, a, { createdAt: NOW - (40 - i) * DAY, startedAt: NOW - (39 - i) * DAY, doneAt: NOW - (38 - i) * DAY, dueAt: NOW - (36 - i) * DAY }));
    sync.saveBatch("ws_default", { people: [a], tasks, commits: [], prs: [], notes: [] }, NOW);
    const [card] = analyzeTeam(load.loadDataset("ws_default"), NOW, 30);
    expect(card.person.name).toBe("Aria Shah");
    expect(card.metrics.current.completed).toBeGreaterThan(10);
    expect(card.metrics.current.reworkRate).toBeNull(); // ClickUp cannot say: shown as unknown, not as a perfect 0%
  });
});

describe("integration store", () => {
  it("keeps the token encrypted when AUTH_SECRET is set and never lists it", async () => {
    const { store, db } = await fresh();
    process.env.AUTH_SECRET = "x".repeat(40);
    const id = store.saveIntegration({ workspaceId: "ws_default", provider: "github", label: "GitHub", config: { org: "acme" }, secret: "ghp_supersecret" });
    const raw = (db().prepare("SELECT secret FROM integrations WHERE id = ?").get(id) as any).secret as string;
    expect(raw.startsWith("enc:")).toBe(true);
    expect(raw).not.toContain("ghp_supersecret");
    expect(JSON.stringify(store.listIntegrations("ws_default"))).not.toContain("secret");
    expect(store.getIntegration(id, "ws_default")?.secret).toBe("ghp_supersecret");
    expect(store.getIntegration(id, "other_workspace")).toBeNull(); // another workspace cannot read it
  });
});

describe("account suggestions", () => {
  it("suggests a login that starts with the first name plus last initial, but never applies it", async () => {
    const { suggestPerson } = await import("../lib/integrations/identity");
    const people = [{ id: "1", name: "Yash Pattnaik" }, { id: "2", name: "Reema Nayak" }, { id: "3", name: "Yashika Rao" }];
    expect(suggestPerson({ externalId: "YashpDigiP" }, people)).toMatchObject({ personId: "1" });
    expect(suggestPerson({ externalId: "ReemaDigiP" }, people)).toMatchObject({ personId: "2" });
    expect(suggestPerson({ externalId: "octocat" }, people)).toBeNull();
    expect(suggestPerson({ externalId: "yash" }, [{ id: "1", name: "Yash Pattnaik" }, { id: "4", name: "Yash Kumar" }])).toBeNull(); // two Yashes: a guess, so no suggestion
  });

  it("moves an account's commits to the chosen person, and refuses people from another workspace", async () => {
    const { sync, load, store } = await fresh();
    const { linkIdentity } = await import("../lib/integrations/identity");
    store.ensureWorkspace("other", "Other");
    const a = { provider: "clickup" as const, externalId: "11", name: "Yash Pattnaik", email: "y@acme.com" };
    sync.saveBatch("ws_default", { people: [a], tasks: [], commits: [{ repo: "r", sha: "s", author: { provider: "github", externalId: "YashpDigiP", login: "YashpDigiP" }, at: NOW - DAY, additions: 3, deletions: 1, message: "feat: work" }], prs: [], notes: [] }, NOW);
    expect(load.loadDataset("ws_default").commits).toHaveLength(0);
    const [acct] = load.unlinkedAccounts("ws_default");
    const person = load.loadDataset("ws_default").people[0];
    expect(linkIdentity("other", acct.id, person.id)).toBe(false); // wrong workspace: nothing happens
    expect(linkIdentity("ws_default", acct.id, person.id)).toBe(true);
    expect(load.loadDataset("ws_default").commits).toHaveLength(1);
    expect(linkIdentity("ws_default", acct.id, null)).toBe(true); // and it can be undone
    expect(load.loadDataset("ws_default").commits).toHaveLength(0);
  });
});

describe("promotion pull requests", () => {
  it("a PR coming from a branch that other PRs merge into is a release step, not its author's delivery", async () => {
    const { sync, load } = await fresh();
    const { personMetrics } = await import("../lib/analytics/metrics");
    const { npr } = await import("./helpers");
    const dara = { provider: "clickup" as const, externalId: "9", name: "Dara Okafor", email: "dara@acme.com" };
    const gh = { provider: "github" as const, externalId: "dara-gh", login: "dara-gh", email: "dara@acme.com" };
    const base = { author: gh, openedAt: NOW - 3 * DAY, mergedAt: NOW - 2 * DAY };
    sync.saveBatch("ws_default", {
      people: [dara], tasks: [], commits: [], notes: [],
      prs: [
        npr({ ...base, repo: "acme/app", number: 1, headBranch: "feat/login", baseBranch: "develop" }), // her own work
        npr({ ...base, repo: "acme/app", number: 2, headBranch: "feat/reports", baseBranch: "develop" }), // her own work
        npr({ ...base, repo: "acme/app", number: 3, headBranch: "develop", baseBranch: "pre-develop" }), // promotes develop: others' work
        npr({ ...base, repo: "acme/app", number: 4, headBranch: "pre-develop", baseBranch: "main" }), // promotes again
        npr({ ...base, repo: "acme/app", number: 5, headBranch: "release/1.4", baseBranch: "main" }), // a release branch by name
      ],
    }, NOW);
    const ds = load.loadDataset("ws_default");
    expect(Object.fromEntries(ds.prs.map((p) => [p.number, p.promotion]))).toEqual({ 1: false, 2: false, 3: true, 4: true, 5: true });
    const m = personMetrics(ds, ds.people[0].id, NOW, 30).current;
    expect(m.prsMerged).toBe(2); // only what she built
    expect(m.promotionsMerged).toBe(3); // the rest is reported, not hidden
  });
});

describe("repositories that are no longer connected", () => {
  const setup = async () => {
    const f = await fresh();
    const { npr, nc } = await import("./helpers");
    const gh = { provider: "github" as const, externalId: "a", login: "a" };
    f.sync.saveBatch("ws_default", {
      people: [], tasks: [], notes: [],
      commits: [nc({ repo: "org/kept", sha: "1", author: gh, at: NOW }), nc({ repo: "me/personal-test", sha: "2", author: gh, at: NOW })],
      prs: [npr({ repo: "org/kept", number: 1, author: gh }), npr({ repo: "me/personal-test", number: 2, author: gh })],
    }, NOW);
    const id = f.store.saveIntegration({ workspaceId: "ws_default", provider: "github", label: "GitHub", config: { org: "org" }, secret: "ghp_abcdefgh" });
    const n = (t: string, repo: string) => (f.db().prepare(`SELECT COUNT(*) c FROM ${t} WHERE repo = ?`).get(repo) as any).c;
    return { ...f, id, n };
  };

  it("a full sync removes commits and PRs from repositories the integration no longer covers", async () => {
    const { sync, id, n } = await setup();
    const removed = sync.pruneUncoveredRepos("ws_default", id, ["org/kept"]);
    expect(removed).toBe(2);
    expect([n("commits", "org/kept"), n("pull_requests", "org/kept")]).toEqual([1, 1]);
    expect([n("commits", "me/personal-test"), n("pull_requests", "me/personal-test")]).toEqual([0, 0]);
  });

  it("another integration that covers a repository keeps its data", async () => {
    const { sync, store, id, n } = await setup();
    const other = store.saveIntegration({ workspaceId: "ws_default", provider: "github", label: "Second org", config: {}, secret: "ghp_zzzzzzzz" });
    sync.pruneUncoveredRepos("ws_default", other, ["me/personal-test"]);
    expect(sync.pruneUncoveredRepos("ws_default", id, ["org/kept"])).toBe(0); // covered by the other integration: nothing is removed
    expect(n("commits", "me/personal-test")).toBe(1);
  });

  it("an ordinary (incremental) sync never prunes: the repositories it read are only the recently active ones", async () => {
    const { sync, store, id, n, db } = await setup();
    db().prepare("UPDATE integrations SET last_sync_at = ? WHERE id = ?").run(NOW - DAY, id);
    const { ADAPTERS } = sync;
    const spy = vi.spyOn(ADAPTERS.github, "sync").mockResolvedValue({ people: [], tasks: [], commits: [], prs: [], notes: [], repos: ["org/kept"] });
    const r = await sync.syncIntegration("ws_default", id, { now: NOW });
    expect(r.ok).toBe(true);
    expect(n("commits", "me/personal-test")).toBe(1); // untouched
    const full = await sync.syncIntegration("ws_default", id, { now: NOW, full: true });
    expect(full.ok && full.notes.join(" ")).toMatch(/Removed 2 commits and pull requests/);
    expect(n("commits", "me/personal-test")).toBe(0);
    spy.mockRestore();
    void store;
  });
});
