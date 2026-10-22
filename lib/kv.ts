import { promises as fs } from "fs";
import path from "path";

// One small storage interface for everything the app remembers (settings, audit log, chats, pending approvals).
//
//   redis  - Upstash Redis over HTTP. Used whenever KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_*
//            pair) are set. This is what makes the app work on Vercel/serverless, where files can't be written and
//            every request may land on a different server instance.
//   file   - JSON files under ./data. Used on your own machine.
//   memory - Per-instance fallback on serverless hosts with no Redis configured. Nothing crashes, but nothing is
//            remembered reliably either (a warning is logged once).
//
// Force one with KV_BACKEND=memory|file (the tests use memory).
export interface KV {
  readonly kind: "redis" | "file" | "memory";
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  take<T>(key: string): Promise<T | null>; // read and delete in one step, so a value can only be used once
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  push(key: string, value: unknown, max: number): Promise<void>; // append to a capped list
  list<T>(key: string, n: number): Promise<T[]>; // newest first
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;
const safe = (key: string) => {
  if (!KEY.test(key) || key.includes("..")) throw new Error(`Invalid storage key: ${key}`);
  return key;
};

// ---------- Redis (Upstash REST) ----------
function redis(url: string, token: string): KV {
  const NS = "clickup-assistant:";
  async function cmd(args: (string | number)[]): Promise<any> {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Storage error: ${body.error ?? res.status}`);
    return body.result;
  }
  const parse = <T,>(s: string | null): T | null => (s === null || s === undefined ? null : (JSON.parse(s) as T));
  return {
    kind: "redis",
    get: async (k) => parse(await cmd(["GET", NS + safe(k)])),
    set: async (k, v, ttl) => void (await cmd(ttl ? ["SET", NS + safe(k), JSON.stringify(v), "EX", ttl] : ["SET", NS + safe(k), JSON.stringify(v)])),
    take: async (k) => parse(await cmd(["GETDEL", NS + safe(k)])),
    del: async (k) => void (await cmd(["DEL", NS + safe(k)])),
    keys: async (prefix) => {
      const out: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = (await cmd(["SCAN", cursor, "MATCH", `${NS}${prefix}*`, "COUNT", 200])) as [string, string[]];
        out.push(...batch.map((k) => k.slice(NS.length)));
        cursor = next;
      } while (cursor !== "0");
      return out;
    },
    push: async (k, v, max) => {
      await cmd(["LPUSH", NS + safe(k), JSON.stringify(v)]);
      await cmd(["LTRIM", NS + safe(k), 0, max - 1]);
    },
    list: async (k, n) => ((await cmd(["LRANGE", NS + safe(k), 0, n - 1])) as string[]).map((s) => JSON.parse(s)),
  };
}

// ---------- Files (local) ----------
function files(): KV {
  const root = () => path.join(process.cwd(), "data"); // read at use time so tests can change directory
  const fileOf = (k: string) => path.join(root(), ...safe(k).split("/")) + ".json";
  const get = async <T,>(k: string): Promise<T | null> => {
    try {
      return JSON.parse(await fs.readFile(fileOf(k), "utf8")) as T;
    } catch {
      return null;
    }
  };
  const set = async (k: string, v: unknown) => {
    const f = fileOf(k);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify(v));
  };
  return {
    kind: "file",
    get,
    set, // ttl is not needed locally: expiry is also checked by whoever reads the value
    take: async (k) => {
      const v = await get(k);
      if (v !== null) await fs.rm(fileOf(k), { force: true });
      return v as never;
    },
    del: async (k) => void (await fs.rm(fileOf(k), { force: true })),
    keys: async (prefix) => {
      const dir = path.join(root(), ...prefix.split("/").filter(Boolean));
      try {
        return (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).map((n) => prefix.replace(/\/?$/, "/") + n.slice(0, -5));
      } catch {
        return [];
      }
    },
    push: async (k, v, max) => set(k, [...((await get<unknown[]>(k)) ?? []), v].slice(-max)),
    list: async <T,>(k: string, n: number) => ((await get<T[]>(k)) ?? []).slice(-n).reverse(),
  };
}

// ---------- Memory (fallback) ----------
function memory(): KV {
  const g = globalThis as unknown as { __kvMem?: { kv: Map<string, { v: string; exp?: number }>; lists: Map<string, string[]> } };
  const m = (g.__kvMem ??= { kv: new Map(), lists: new Map() }); // survives hot reloads
  const live = (k: string) => {
    const e = m.kv.get(safe(k));
    if (e?.exp && e.exp < Date.now()) {
      m.kv.delete(k);
      return undefined;
    }
    return e;
  };
  return {
    kind: "memory",
    get: async <T,>(k: string) => (live(k) ? (JSON.parse(live(k)!.v) as T) : null),
    set: async (k, v, ttl) => void m.kv.set(safe(k), { v: JSON.stringify(v), exp: ttl ? Date.now() + ttl * 1000 : undefined }),
    take: async <T,>(k: string) => {
      const e = live(k);
      m.kv.delete(k);
      return e ? (JSON.parse(e.v) as T) : null;
    },
    del: async (k) => void m.kv.delete(safe(k)),
    keys: async (prefix) => [...m.kv.keys()].filter((k) => k.startsWith(prefix) && live(k)),
    push: async (k, v, max) => void m.lists.set(safe(k), [JSON.stringify(v), ...(m.lists.get(k) ?? [])].slice(0, max)),
    list: async <T,>(k: string, n: number) => (m.lists.get(k) ?? []).slice(0, n).map((s: string) => JSON.parse(s) as T),
  };
}

let chosen: KV | undefined;
export function kv(): KV {
  if (chosen) return chosen;
  const forced = process.env.KV_BACKEND;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

  if (forced === "memory") chosen = memory();
  else if (forced === "file") chosen = files();
  else if (url && token) chosen = redis(url, token);
  else if (serverless) {
    console.warn("[storage] No Redis configured on a serverless host: settings, chats and approvals are NOT saved reliably. Add an Upstash Redis integration (KV_REST_API_URL / KV_REST_API_TOKEN).");
    chosen = memory();
  } else chosen = files();
  return chosen;
}
