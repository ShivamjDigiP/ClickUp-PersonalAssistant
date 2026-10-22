import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  clickup: vi.fn(),
}));
vi.mock("../lib/llm", () => ({ generate: mocks.generate }));
vi.mock("../lib/clickup/client", () => ({ clickup: mocks.clickup }));
vi.mock("../lib/git/github", async (orig) => ({
  ...(await orig<typeof import("../lib/git/github")>()),
  getPr: vi.fn(async (repo: string, number: number) => ({
    title: `PR ${number}`,
    state: number === 5 ? "merged" : "open",
    url: `https://github.com/${repo}/pull/${number}`,
    description: "Fixes the blank date",
    commits: ["fix habit date"],
  })),
  changelogOf: vi.fn(async () => "- Fixed: habit without image no longer shows a blank date"),
}));

import { buildPrompt, formatComment, parsePoints, proposeComment } from "../lib/pr-comments/draft";
import { listPrs } from "../lib/pr-comments/candidates";
import * as github from "../lib/git/github";

process.env.KV_BACKEND = "memory";

afterEach(() => {
  mocks.generate.mockReset();
  mocks.clickup.mockReset();
});

const evidence = (n: number, state = "merged") => ({ repo: "acme/app", number: n, state, url: `https://x/${n}` });
const reply = (obj: unknown) => ({ role: "model", parts: [{ text: JSON.stringify(obj) }] });

describe("formatComment", () => {
  it("lists each PR on one line, then at most 4 short bullets with list markers removed", () => {
    const text = formatComment([evidence(5), evidence(6, "open")], ["- One", "* Two", "1) Three", "Four", "Five is dropped"]);
    expect(text).toBe("PR app#5 (merged) https://x/5\nPR app#6 (open) https://x/6\n• One\n• Two\n• Three\n• Four");
  });

  it("returns nothing when there are no points, so a bare link is never posted", () => {
    expect(formatComment([evidence(5)], ["", "  "])).toBe("");
  });

  it("cuts a very long bullet", () => {
    expect(formatComment([evidence(5)], ["x".repeat(500)]).split("\n")[1].length).toBeLessThanOrEqual(152);
  });
});

describe("parsePoints", () => {
  it("reads bare, fenced and wrapped JSON", () => {
    const json = '{"points":["One"]}';
    expect(parsePoints(json)).toEqual(["One"]);
    expect(parsePoints("```json\n" + json + "\n```")).toEqual(["One"]);
    expect(parsePoints(JSON.stringify({ text: json }))).toEqual(["One"]);
    expect(() => parsePoints("nope")).toThrow();
  });
});

describe("buildPrompt", () => {
  it("gives the model the task and each PR's changelog", () => {
    const p = buildPrompt({ name: "Habits bug", description: "blank date" }, [
      { key: "a#1", repo: "a", number: 1, title: "T", state: "merged", url: "u", changelog: "Fixed X", description: "", commits: ["c1"] },
    ]);
    expect(p).toContain("TASK: Habits bug");
    expect(p).toContain("Changelog: Fixed X");
  });
});

describe("proposeComment", () => {
  const ok = () => {
    mocks.clickup.mockResolvedValue({ id: "86abc12de", name: "Habits created without image", text_content: "" });
    mocks.generate.mockResolvedValue(reply({ points: ["Fixed the blank date shown for habits created without an image", "Admins can now see when each habit was last updated"] }));
  };

  it("writes ONE comment for the task covering all ticked PRs, and queues it for approval", async () => {
    ok();
    const out = await proposeComment("86abc12de", [{ repo: "acme/app", number: 5 }, { repo: "acme/app", number: 6 }], false);
    expect(out.proposal).toMatchObject({ tool: "add_comment" });
    expect(out.proposal.args).toMatchObject({ task_id: "86abc12de", comment: expect.stringContaining("PR app#6 (open)") });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate PRs and rejects an empty or invalid selection", async () => {
    ok();
    await proposeComment("86abc12de", [{ repo: "acme/app", number: 5 }, { repo: "acme/app", number: 5 }], false);
    expect(String(mocks.generate.mock.calls[0][1][0].parts[0].text).match(/### PR/g)).toHaveLength(1);
    await expect(proposeComment("86abc12de", [], false)).rejects.toThrow(/at least one PR/);
    await expect(proposeComment("!", [{ repo: "acme/app", number: 5 }], false)).rejects.toThrow(/Choose a ClickUp task/);
    await expect(proposeComment("86abc12de", [{ repo: "../x", number: 5 }], false)).rejects.toThrow(/owner\/name/);
    await expect(proposeComment("86abc12de", [{ repo: "acme/app", number: 0 }], false)).rejects.toThrow(/not a PR number/);
  });

  it("does not post anything when the AI gives no usable points", async () => {
    mocks.clickup.mockResolvedValue({ id: "86abc12de", name: "Habits" });
    mocks.generate.mockResolvedValue(reply({ points: [] }));
    await expect(proposeComment("86abc12de", [{ repo: "acme/app", number: 5 }], false)).rejects.toThrow(/usable comment/);
  });

  it("fails clearly when the task does not exist", async () => {
    mocks.clickup.mockRejectedValue(new Error("ClickUp 404: Task not found"));
    await expect(proposeComment("86abc12de", [{ repo: "acme/app", number: 5 }], false)).rejects.toThrow(/404/);
  });
});

describe("listPrs", () => {
  it("puts PRs that name the chosen task first", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          items: [
            { repository_url: "https://api.github.com/repos/acme/app", number: 1, title: "Unrelated", state: "open", html_url: "u1", updated_at: "2026-10-20T00:00:00Z", body: "" },
            { repository_url: "https://api.github.com/repos/acme/app", number: 2, title: "CU-86abc12de fix", state: "closed", html_url: "u2", updated_at: "2026-10-20T00:00:00Z", body: "", pull_request: { merged_at: "2026-10-20T00:00:00Z" } },
          ],
        }),
      ),
    );
    const prs = await listPrs([], 30, "86ABC12DE");
    expect(prs.map((p) => [p.number, p.linked, p.state])).toEqual([[2, true, "merged"], [1, false, "open"]]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    expect(github).toBeDefined();
  });
});
