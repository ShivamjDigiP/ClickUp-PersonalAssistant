import { kv } from "./kv";

// Fixed-window rate limit: at most `max` calls per `windowSec` for a given key.
export type Limit = { ok: true; remaining: number } | { ok: false; retryAfter: number };

export async function limit(key: string, max: number, windowSec: number): Promise<Limit> {
  const safeKey = `rl/${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  try {
    const n = await kv().incr(safeKey, windowSec);
    return n <= max ? { ok: true, remaining: max - n } : { ok: false, retryAfter: windowSec };
  } catch {
    return { ok: true, remaining: max }; // if the counter store is down, don't lock everyone out
  }
}

export const clientIp = (req: Request) =>
  (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
