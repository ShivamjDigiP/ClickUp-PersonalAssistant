import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["KV_BACKEND", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL"]) delete process.env[k];
  Object.assign(process.env, env);
  return (await import("../lib/kv")).kv();
}
afterEach(() => vi.unstubAllGlobals());

describe("memory backend", () => {
  it("stores, expires and takes values once", async () => {
    const kv = await load({ KV_BACKEND: "memory" });
    expect(kv.kind).toBe("memory");
    await kv.set("a/b", { n: 1 });
    expect(await kv.get("a/b")).toEqual({ n: 1 });
    expect(await kv.take("a/b")).toEqual({ n: 1 });
    expect(await kv.take("a/b")).toBeNull(); // single use
    await kv.set("t", 1, 1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    expect(await kv.get("t")).toBeNull(); // expired
    vi.useRealTimers();
  });

  it("keeps a capped list, newest first", async () => {
    const kv = await load({ KV_BACKEND: "memory" });
    for (const n of [1, 2, 3, 4]) await kv.push("log", n, 3);
    expect(await kv.list("log", 10)).toEqual([4, 3, 2]);
    expect(await kv.list("log", 1)).toEqual([4]);
  });

  it("lists keys by prefix and rejects unsafe keys", async () => {
    const kv = await load({ KV_BACKEND: "memory" });
    await kv.set("chats/one", 1);
    await kv.set("chats/two", 2);
    await kv.set("settings", 3);
    expect((await kv.keys("chats/")).sort()).toEqual(["chats/one", "chats/two"]);
    await expect(kv.get("../etc/passwd")).rejects.toThrow(/Invalid/);
  });
});

describe("backend choice", () => {
  it("uses Redis when its URL and token are set", async () => {
    expect((await load({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })).kind).toBe("redis");
    expect((await load({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).kind).toBe("redis");
  });
  it("falls back to memory on a serverless host without Redis, and files locally", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await load({ VERCEL: "1" })).kind).toBe("memory");
    expect((await load({})).kind).toBe("file");
  });
});

describe("redis backend (HTTP calls)", () => {
  it("sends the right commands and decodes results", async () => {
    const calls: unknown[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
        const cmd = JSON.parse(init.body);
        calls.push(cmd);
        expect(init.headers.Authorization).toBe("Bearer tok");
        const result = cmd[0] === "GETDEL" ? JSON.stringify({ ok: 1 }) : cmd[0] === "SCAN" ? ["0", ["clickup-assistant:chats/x"]] : cmd[0] === "LRANGE" ? ['{"a":1}'] : "OK";
        return new Response(JSON.stringify({ result }), { status: 200 });
      }),
    );
    const kv = await load({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "tok" });
    await kv.set("pending/1", { a: 1 }, 900);
    expect(calls[0]).toEqual(["SET", "clickup-assistant:pending/1", '{"a":1}', "EX", 900]);
    expect(await kv.take("pending/1")).toEqual({ ok: 1 }); // GETDEL = atomic single use
    expect(await kv.keys("chats/")).toEqual(["chats/x"]);
    await kv.push("audit", { a: 1 }, 500);
    expect(calls.slice(-2)).toEqual([["LPUSH", "clickup-assistant:audit", '{"a":1}'], ["LTRIM", "clickup-assistant:audit", 0, 499]]);
    expect(await kv.list("audit", 5)).toEqual([{ a: 1 }]);
  });

  it("surfaces storage errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "WRONGPASS" }), { status: 401 })));
    const kv = await load({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "bad" });
    await expect(kv.get("settings")).rejects.toThrow(/WRONGPASS/);
  });
});
