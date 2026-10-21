const BASE = "https://api.clickup.com/api/v2";

type Params = Record<string, string | number | boolean | Array<string | number> | undefined>;

// Pulse, Me and chat all fan out across many lists at once; cap in-flight requests so bursts
// stay under ClickUp's ~100 requests/min limit instead of tripping 429s.
const MAX_IN_FLIGHT = 6;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export async function clickup<T = any>(
  path: string,
  params: Params = {},
  init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<T> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not set in .env.local");

  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(`${key}[]`, String(v)));
    else url.searchParams.set(key, String(value));
  }

  // ClickUp allows ~100 requests/min; retry politely on 429.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await slot(() =>
        fetch(url, {
          method: init.method ?? "GET",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: init.body ? JSON.stringify(init.body) : undefined,
          cache: "no-store",
        }),
      );
    } catch (e) {
      // Transient network errors (ECONNRESET etc.): retry GETs only, never replay a write.
      if ((init.method ?? "GET") === "GET" && attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
    if (res.status === 429 && attempt < 4) {
      // X-RateLimit-Reset is an epoch-seconds timestamp for when the window reopens.
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
      const wait = reset > 0 && reset < 15_000 ? reset + 250 : 1500 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<T>;
  }
}
