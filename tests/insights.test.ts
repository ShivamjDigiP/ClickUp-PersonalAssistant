import { describe, expect, it, vi } from "vitest";
import { seedDataset } from "../lib/analytics/seed";
import { analyzeTeam } from "../lib/analytics/capability";
import { buildInsightInput, generateInsight, parseInsightReply, ruleBasedInsight, ungroundedNumbers } from "../lib/analytics/insights";

const NOW = Date.UTC(2026, 9, 26, 12);
const ds = seedDataset(NOW);
const cards = analyzeTeam(ds, NOW, 30);
const inputFor = (id: string) => {
  const c = cards.find((x) => x.person.id === id)!;
  return buildInsightInput(c, cards.length, NOW);
};
const reply = (o: unknown) => ({ role: "model" as const, parts: [{ text: JSON.stringify(o) }] });

describe("grounding", () => {
  const input = inputFor("p-aria");

  it("accepts numbers that are in the data, including rounded ones", () => {
    expect(ungroundedNumbers(`Completed ${input.completedNow} tasks, ${input.onTimePercent}% on time`, input)).toEqual([]);
  });

  it("flags a number the model invented", () => {
    expect(ungroundedNumbers("Completed 999 tasks and fixed 4242 bugs", input)).toEqual(["999", "4242"]);
  });
});

describe("generateInsight", () => {
  const input = inputFor("p-aria");
  const good = { headline: `Aria finished ${input.completedNow} tasks.`, doingWell: [`${input.onTimePercent}% on time`], risks: [], actions: [] };

  it("returns the model's text when every number is grounded, and caches it", async () => {
    const store = new Map<string, any>();
    const cache = { get: async (h: string) => store.get(h) ?? null, set: async (h: string, v: any) => void store.set(h, v) };
    const gen = vi.fn(async () => reply(good));
    const first = await generateInsight(input, { gen, cache });
    expect(first.source).toBe("ai");
    await generateInsight(input, { gen, cache });
    expect(gen).toHaveBeenCalledTimes(1); // second call served from the cache
  });

  it("rejects an invented number, retries once with feedback, then uses it if fixed", async () => {
    const gen = vi
      .fn()
      .mockResolvedValueOnce(reply({ ...good, headline: "Aria shipped 777 tasks." }))
      .mockResolvedValueOnce(reply(good));
    const out = await generateInsight(input, { gen });
    expect(out.source).toBe("ai");
    expect(gen).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(gen.mock.calls[1][1])).toContain("777");
  });

  it("falls back to rule-based text built from the same numbers when the model keeps inventing", async () => {
    const gen = vi.fn(async () => reply({ ...good, headline: "Aria shipped 777 tasks." }));
    const out = await generateInsight(input, { gen });
    expect(out.source).toBe("rules");
    expect(ungroundedNumbers(JSON.stringify(out.insight), input)).toEqual([]);
  });

  it("falls back when the provider fails or returns junk", async () => {
    expect((await generateInsight(input, { gen: async () => { throw new Error("all models at limit"); } })).source).toBe("rules");
    expect((await generateInsight(input, { gen: async () => ({ role: "model", parts: [{ text: "not json" }] }) })).source).toBe("rules");
  });

  it("never asks the model to judge someone with too little history", async () => {
    const gen = vi.fn();
    const out = await generateInsight(inputFor("p-eli"), { gen });
    expect(gen).not.toHaveBeenCalled();
    expect(out.insight.headline).toMatch(/too little history/);
  });
});

describe("parseInsightReply and rules", () => {
  it("accepts fenced JSON and the {text} wrapper", () => {
    const o = { headline: "h", doingWell: [], risks: [], actions: [] };
    expect(parseInsightReply("```json\n" + JSON.stringify(o) + "\n```").headline).toBe("h");
    expect(parseInsightReply(JSON.stringify({ text: JSON.stringify(o) })).headline).toBe("h");
  });

  it("rule text states the facts without grading anyone, and suggests an action", () => {
    const r = ruleBasedInsight(inputFor("p-chen"));
    expect(r.headline).toMatch(/finished \d+ tasks?/);
    expect(JSON.stringify(r)).not.toMatch(/needs support|exceeding|on track|doing very well/i);
    expect(r.risks.length).toBeGreaterThan(0);
    expect(r.actions.length).toBeGreaterThan(0);
  });
});
