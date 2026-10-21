import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compactHistory } from "../lib/llm/compact";

const tmp = mkdtempSync(path.join(tmpdir(), "chats-"));
const cwd = process.cwd();
afterAll(() => {
  process.chdir(cwd);
  rmSync(tmp, { recursive: true, force: true });
});

async function load() {
  vi.resetModules();
  process.chdir(tmp);
  rmSync(path.join(tmp, "data"), { recursive: true, force: true });
  return import("../lib/chats");
}
const ID1 = "11111111-aaaa-bbbb-cccc-000000000001";
const ID2 = "11111111-aaaa-bbbb-cccc-000000000002";
const chat = (id: string, q: string, a: string) => ({
  id,
  bubbles: [{ role: "user", text: q }, { role: "assistant", text: a, fresh: true }],
  history: [{ role: "user", parts: [{ text: q }] }],
  outcomes: {},
});

describe("chat store", () => {
  let c: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => (c = await load()));

  it("saves, lists and reloads a session, titled from the first message", async () => {
    await c.saveChat(chat(ID1, "Show progress of Imported from Jira", "96% done"));
    const [meta] = await c.listChats();
    expect(meta.title).toBe("Show progress of Imported from Jira");
    const s = await c.getChat(ID1);
    expect(s?.bubbles[1].fresh).toBeUndefined();
    expect(s?.history).toHaveLength(1);
  });

  it("keeps the original title and createdAt on re-save", async () => {
    await c.saveChat(chat(ID1, "first question", "a"));
    const before = await c.getChat(ID1);
    await c.saveChat({ ...chat(ID1, "first question", "a"), bubbles: [...chat(ID1, "first question", "a").bubbles, { role: "user", text: "second" }] });
    const after = await c.getChat(ID1);
    expect(after?.title).toBe("first question");
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.bubbles).toHaveLength(3);
  });

  it("deletes sessions and rejects unsafe ids", async () => {
    await c.saveChat(chat(ID1, "q", "a"));
    await c.deleteChat(ID1);
    expect(await c.getChat(ID1)).toBeNull();
    await expect(c.saveChat({ ...chat("../../etc/passwd", "q", "a") })).rejects.toThrow(/Invalid/);
    expect(await c.getChat("../settings")).toBeNull();
    expect(readdirSync(path.join(tmp, "data")).includes("settings.json")).toBe(false);
  });

  it("builds a memory digest from other sessions only", async () => {
    await c.saveChat(chat(ID1, "How many overdue tasks?", "6 overdue tasks in Imported from Jira"));
    await c.saveChat(chat(ID2, "something else", "other answer"));
    const d = await c.recentDigest(ID2);
    expect(d).toContain("How many overdue tasks?");
    expect(d).toContain("6 overdue tasks");
    expect(d).not.toContain("something else");
  });
});

describe("compactHistory", () => {
  const big = { functionResponse: { name: "get_tasks", response: { result: "x".repeat(5000) } } };
  const small = { functionResponse: { name: "get_hierarchy", response: { result: "ok" } } };
  const history: any[] = [
    { role: "user", parts: [{ text: "q1" }] },
    { role: "model", parts: [{ functionCall: { name: "get_tasks", args: {} } }] },
    { role: "user", parts: [big, small] },
    { role: "model", parts: [{ text: "answer 1" }] },
    { role: "user", parts: [{ text: "q2" }] },
    { role: "model", parts: [{ functionCall: { name: "get_tasks", args: {} } }] },
    { role: "user", parts: [big] },
  ];

  it("trims large results from earlier turns but not the current one", () => {
    const out = compactHistory(history);
    expect(JSON.stringify(out[2].parts[0])).toContain("trimmed");
    expect(JSON.stringify(out[2].parts[0]).length).toBeLessThan(900);
    expect(out[2].parts[1]).toEqual(small); // small results stay
    expect(out[6].parts[0]).toEqual(big); // current turn untouched
  });
});
