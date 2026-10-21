import { describe, it, expect, vi, beforeEach } from "vitest";

const geminiOk = { candidates: [{ content: { role: "model", parts: [{ text: "from gemini" }] } }] };
const groqOk = { choices: [{ message: { content: "from groq" } }] };
const quota = (id: string, retry = "1s") =>
  new Response(
    JSON.stringify({
      error: {
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: id }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry },
        ],
      },
    }),
    { status: 429 },
  );
const DAILY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";
const user = [{ role: "user" as const, parts: [{ text: "x" }] }];

async function load() {
  vi.resetModules();
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "q";
  process.env.GEMINI_MIN_GAP_MS = "0";
  process.env.LLM_CHAIN = "gemini:pro,gemini:flash,groq:big";
  return (await import("../lib/llm")).generate;
}
const urlOf = (f: any, i: number) => String(f.mock.calls[i][0]);

beforeEach(() => vi.restoreAllMocks());

describe("llm chain", () => {
  it("retries a per-minute 429 on the same model", async () => {
    const generate = await load();
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(quota("PerMinute", "0.01s"))
      .mockResolvedValueOnce(Response.json(geminiOk));
    expect((await generate("s", user, [])).parts[0].text).toBe("from gemini");
    expect(f).toHaveBeenCalledTimes(2);
    expect(urlOf(f, 1)).toContain("models/pro:");
  });

  it("moves to the next Gemini model on a daily 429", async () => {
    const generate = await load();
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(quota(DAILY))
      .mockResolvedValueOnce(Response.json(geminiOk));
    await generate("s", user, []);
    expect(urlOf(f, 1)).toContain("models/flash:");
  });

  it("falls back to Groq when all Gemini models are exhausted", async () => {
    const generate = await load();
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).includes("groq.com") ? Response.json(groqOk) : quota(DAILY),
    );
    expect((await generate("s", user, [])).parts[0].text).toBe("from groq");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("skips cooled-down models on the next call", async () => {
    const generate = await load();
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) =>
      String(u).includes("groq.com") ? Response.json(groqOk) : quota(DAILY),
    );
    await generate("s", user, []);
    f.mockClear();
    await generate("s", user, []);
    expect(f).toHaveBeenCalledTimes(1);
    expect(urlOf(f, 0)).toContain("groq.com");
  });

  it("gives a friendly error when every model fails", async () => {
    const generate = await load();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => quota(DAILY));
    await expect(generate("s", user, [])).rejects.toThrow(/at their limits/);
  });
});

describe("groq conversion", () => {
  it("maps Gemini tool calls/responses to OpenAI messages", async () => {
    const { toOpenAI } = await import("../lib/llm/groq");
    const msgs = toOpenAI("sys", [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ functionCall: { name: "get_hierarchy", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_hierarchy", response: { result: [] } } }] },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(msgs[2].tool_calls[0].id).toBe(msgs[3].tool_call_id);
  });
});
