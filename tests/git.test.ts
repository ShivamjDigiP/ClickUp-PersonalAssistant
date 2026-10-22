import { afterEach, describe, expect, it, vi } from "vitest";
import { assertRepo, getPr, linkedTaskIds, listMyPrs } from "../lib/git/github";

process.env.KV_BACKEND = "memory";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("linkedTaskIds", () => {
  it("finds CU- ids and task urls, once each, lowercased", () => {
    expect(linkedTaskIds("fix: CU-86ABC12de login", "see https://app.clickup.com/t/9012345/86abc12de and CU-86zzz99", null)).toEqual(["86abc12de", "86zzz99"]);
  });

  it("ignores text without task references", () => {
    expect(linkedTaskIds("just a normal commit", undefined)).toEqual([]);
  });
});

describe("repo names", () => {
  it("rejects malformed names but accepts any owner/name", () => {
    expect(() => assertRepo("../etc/passwd")).toThrow(/owner\/name/);
    expect(() => assertRepo("../x")).toThrow(/owner\/name/);
    expect(() => assertRepo("acme/..")).toThrow(/owner\/name/);
    expect(() => assertRepo("acme/.github")).not.toThrow();
    expect(() => assertRepo("any-org/any.repo")).not.toThrow();
  });
});

describe("GitHub tools", () => {
  const stubGitHub = (routes: Record<string, unknown>) => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      const hit = Object.keys(routes).find((p) => url.pathname === p);
      return hit ? Response.json(routes[hit]) : new Response("not found", { status: 404 });
    }));
  };

  it("lists PRs with merged state and linked tasks", async () => {
    stubGitHub({
      "/search/issues": {
        items: [{ repository_url: "https://api.github.com/repos/acme/app", number: 7, title: "CU-86abc12de add login", state: "closed", html_url: "u", updated_at: "2026-10-20T10:00:00Z", body: "", pull_request: { merged_at: "2026-10-20T09:00:00Z" } }],
      },
    });
    const [pr] = await listMyPrs("all", 14);
    expect(pr).toMatchObject({ repo: "acme/app", number: 7, state: "merged", merged: "2026-10-20", clickup_task_ids: ["86abc12de"] });
  });

  it("gets a PR with the task ids from its branch and commits", async () => {
    stubGitHub({
      "/repos/acme/app/pulls/7": { title: "Add login", state: "open", draft: false, html_url: "u", head: { ref: "feature/CU-86abc12de" }, base: { ref: "main" }, user: { login: "octo" }, body: null, changed_files: 3, additions: 10, deletions: 2 },
      "/repos/acme/app/pulls/7/commits": [{ commit: { message: "wip CU-86zzz99\n\nbody" } }],
    });
    const pr = await getPr("acme/app", 7);
    expect(pr.clickup_task_ids).toEqual(["86abc12de", "86zzz99"]);
    expect(pr.commits).toEqual(["wip CU-86zzz99"]);
  });

  it("explains when GitHub is not connected", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    await expect(listMyPrs("all", 7)).rejects.toThrow(/Configs tab/);
  });
});

describe("listAccessibleRepos", () => {
  it("collects every page of repositories the token can see", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ full_name: `org/repo-${n}-${i}`, private: i % 2 === 0 }));
    const fetchMock = vi.fn(async (url: URL) => Response.json(url.searchParams.get("page") === "1" ? page(1, 100) : page(2, 3)));
    vi.stubGlobal("fetch", fetchMock);
    const { listAccessibleRepos } = await import("../lib/git/github");
    const repos = await listAccessibleRepos();
    expect(repos).toHaveLength(103);
    expect(repos[0]).toEqual({ name: "org/repo-1-0", private: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
