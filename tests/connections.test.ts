import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGemini } from "../lib/connections/ai";
import { checkGitHub, GITHUB_SECRET } from "../lib/connections/github";
import { checkClaudeCli, parseMcpList } from "../lib/connections/claudeCli";
import { isLocalRequest } from "../lib/connections/local";
import { readSecret, removeSecret, saveSecret } from "../lib/connections/secrets";
import { checkConnections } from "../lib/connections";
import { resetCooldowns } from "../lib/llm";

process.env.KV_BACKEND = "memory";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetCooldowns();
  await removeSecret(GITHUB_SECRET);
});

const req = (host: string, headers: Record<string, string> = {}) => new Request(`http://${host}/api/connections`, { headers: { host, ...headers } });

describe("connection checks", () => {
  it("an AI card offers a key form when none is set, and never leaks key values", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const off = await checkGemini();
    expect(off.state).toBe("off");
    expect(off.action?.type).toBe("token");

    vi.stubEnv("GEMINI_API_KEY", "super-secret-value");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const bad = await checkGemini();
    expect(bad.state).toBe("down");
    expect(JSON.stringify(bad)).not.toContain("super-secret-value");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [] })));
    const ok = await checkGemini();
    expect(ok.state).toBe("ok");
    expect(ok.detail).toContain(".env.local");
  });

  it("a key saved from the web replaces the .env key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "from-env");
    await saveSecret("gemini", "from-web");
    const fetchMock = vi.fn(async () => Response.json({ models: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await checkGemini();
    expect(ok.disconnect).toBe("/api/connections/gemini");
    expect(JSON.stringify(fetchMock.mock.calls[0])).toContain("from-web");
    await removeSecret("gemini");
  });

  it("GitHub offers a connect form when no token, flags a rejected token, and is ok when valid", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const off = await checkGitHub();
    expect(off.state).toBe("off");
    expect(off.action?.type).toBe("token");

    vi.stubEnv("GITHUB_TOKEN", "ghp_secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const rejected = await checkGitHub();
    expect(rejected.state).toBe("down");
    expect(JSON.stringify(rejected)).not.toContain("ghp_secret");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ login: "octo" })));
    expect(await checkGitHub()).toMatchObject({ state: "ok" });
  });

  it("a token connected from the web beats .env.local and can be disconnected", async () => {
    vi.stubEnv("GITHUB_TOKEN", "from-env");
    await saveSecret(GITHUB_SECRET, "from-web");
    const fetchMock = vi.fn(async () => Response.json({ login: "octo" }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await checkGitHub();
    expect(ok.disconnect).toBe("/api/connections/github");
    expect(JSON.stringify(fetchMock.mock.calls[0])).toContain("from-web");

    await removeSecret(GITHUB_SECRET);
    expect(await readSecret(GITHUB_SECRET)).toBeNull();
  });

  it("only a plain localhost request counts as local", () => {
    expect(isLocalRequest(req("localhost:3010"))).toBe(true);
    expect(isLocalRequest(req("127.0.0.1:3010"))).toBe(true);
    expect(isLocalRequest(req("my-app.vercel.app"))).toBe(false);
    expect(isLocalRequest(req("localhost:3010", { "x-forwarded-host": "localhost:3010", "x-forwarded-for": "::1" }))).toBe(true); // what Next.js adds itself
    expect(isLocalRequest(req("localhost:3010", { "x-forwarded-host": "abc.trycloudflare.com" }))).toBe(false);
    expect(isLocalRequest(req("localhost:3010", { "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    expect(isLocalRequest(req("localhost:3010", { "cf-connecting-ip": "203.0.113.9" }))).toBe(false);
  });

  it("Claude CLI checks stay off when the request is not local", async () => {
    expect((await checkClaudeCli(false)).state).toBe("off");
  });

  it("parses `claude mcp list` output", () => {
    const out = ["Checking MCP server health...", "", "ClickUp: https://mcp.clickup.com/mcp (HTTP) - ✓ Connected", "figma: https://mcp.figma.com/mcp - ! Needs authentication"].join("\n");
    expect(parseMcpList(out)).toEqual([
      { name: "ClickUp", connected: true },
      { name: "figma", connected: false },
    ]);
  });

  it("every card is always returned", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const all = await checkConnections(false);
    expect(all.map((c) => c.id)).toEqual(["clickup", "gemini", "groq", "github", "claude", "mcp", "storage", "push", "sentry"]);
  });
});

describe("saved keys", () => {
  it("are kept per account with no expiry, and report when they cannot be decrypted", async () => {
    const { secretInfo } = await import("../lib/connections/secrets");
    vi.stubEnv("AUTH_SECRET", "a".repeat(40));
    await saveSecret(GITHUB_SECRET, "ghp_persisted");
    expect(await secretInfo(GITHUB_SECRET)).toMatchObject({ unreadable: false, savedAt: expect.any(String) });
    expect(await readSecret(GITHUB_SECRET)).toBe("ghp_persisted");

    vi.stubEnv("AUTH_SECRET", "b".repeat(40)); // the server's secret changed
    expect(await secretInfo(GITHUB_SECRET)).toMatchObject({ unreadable: true });
    vi.stubEnv("GITHUB_TOKEN", "");
    const card = await checkGitHub();
    expect(card.state).toBe("down");
    expect(card.detail).toContain("Paste it again");
  });
});

describe("GitHub access problems", () => {
  it("explains that a 404 on an organisation repo usually means the token's owner, and points to the fix", async () => {
    const { explain } = await import("../lib/git/github");
    expect(explain(404, "Not Found")).toContain("Resource owner");
    expect(explain(404, "Not Found")).toContain("GitHub CLI login");
    expect(explain(500, "boom")).toBe("GitHub 500: boom");
  });

  it("offers the GitHub CLI login only on the local computer", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    expect((await checkGitHub(true)).more?.[0]).toMatchObject({ endpoint: "/api/connections/github/gh" });
    expect((await checkGitHub(false)).more).toBeUndefined();
  });
});
