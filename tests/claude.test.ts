import { afterEach, describe, expect, it, vi } from "vitest";

const claude = vi.hoisted(() => ({ available: vi.fn(async () => true), generate: vi.fn() }));
vi.mock("../lib/llm/claude", async (orig) => ({ ...(await orig<typeof import("../lib/llm/claude")>()), claudeAvailable: claude.available, generateClaude: claude.generate }));

import { buildPrompt, parseReply } from "../lib/llm/claude";
import { generate, resetCooldowns } from "../lib/llm";

process.env.KV_BACKEND = "memory";
const user = [{ role: "user" as const, parts: [{ text: "hi" }] }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  claude.available.mockResolvedValue(true);
  claude.generate.mockReset();
  resetCooldowns();
});

describe("parseReply", () => {
  it("turns tool calls into function-call parts", () => {
    const m = parseReply('```json\n{"calls":[{"name":"get_my_tasks","args":{"team_id":"1"}},{"name":"get_members"}]}\n```');
    expect(m.parts).toEqual([{ functionCall: { name: "get_my_tasks", args: { team_id: "1" } } }, { functionCall: { name: "get_members", args: {} } }]);
  });
  it("returns text answers, and plain prose as text", () => {
    expect(parseReply('{"text":"Done"}').parts).toEqual([{ text: "Done" }]);
    expect(parseReply("Sure thing").parts).toEqual([{ text: "Sure thing" }]);
  });
});

describe("buildPrompt", () => {
  it("includes tools and tool results from the conversation", () => {
    const tools = [{ name: "get_x", kind: "read" as const, description: "Gets x", parameters: { type: "object" }, run: async () => ({}) }];
    const p = buildPrompt("SYS", [...user, { role: "model", parts: [{ functionCall: { name: "get_x", args: {} } }] }, { role: "user", parts: [{ functionResponse: { name: "get_x", response: { result: 42 } } }] }], tools);
    expect(p).toContain("SYS");
    expect(p).toContain("get_x: Gets x");
    expect(p).toContain('[result of get_x: {"result":42}]');
  });
});

describe("engine order", () => {
  const stubGemini = () => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "from gemini" }] } }] })));

  it("local Claude answers first when the request is local", async () => {
    claude.generate.mockResolvedValue({ role: "model", parts: [{ text: "from claude" }] });
    const seen: unknown[] = [];
    expect((await generate("s", user, [], { local: true, onEngine: (e) => seen.push(e) })).parts[0].text).toBe("from claude");
    expect(seen).toEqual([{ id: "claude-local:sonnet", fellBack: false }]);
  });

  it("does not use Claude for non-local requests", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    stubGemini();
    expect((await generate("s", user, [])).parts[0].text).toBe("from gemini");
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when Claude fails, then skips Claude for a while", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    stubGemini();
    claude.generate.mockRejectedValue(new Error("boom"));
    const seen: { id: string; fellBack: boolean }[] = [];
    expect((await generate("s", user, [], { local: true, onEngine: (e) => seen.push(e) })).parts[0].text).toBe("from gemini");
    expect(seen[0].fellBack).toBe(true);
    await generate("s", user, [], { local: true });
    expect(claude.generate).toHaveBeenCalledTimes(1);
  });

  it("skips Claude when it is not installed or turned off", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    stubGemini();
    claude.available.mockResolvedValue(false);
    await generate("s", user, [], { local: true });
    vi.stubEnv("LLM_PREFER_CLAUDE", "0");
    claude.available.mockResolvedValue(true);
    await generate("s", user, [], { local: true });
    expect(claude.generate).not.toHaveBeenCalled();
  });
});
