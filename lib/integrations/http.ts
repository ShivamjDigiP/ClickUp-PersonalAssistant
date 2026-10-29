// One careful HTTP helper for every adapter: timeouts, rate-limit waits, retries on flaky networks, and error messages
// that name the tool but never contain the token.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type HttpOptions = {
  label: string; // "ClickUp", "GitHub", "Jira": used in error messages
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
};

export async function httpJson<T = any>(url: string | URL, o: HttpOptions): Promise<T> {
  const retries = o.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: o.method ?? "GET",
        headers: { Accept: "application/json", ...(o.body ? { "Content-Type": "application/json" } : {}), ...o.headers },
        body: o.body ? JSON.stringify(o.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      });
    } catch (e) {
      // network blip or timeout: safe to repeat reads (these adapters only read)
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new HttpError(`${o.label}: could not reach the service (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message})`, 0);
    }
    if (res.ok) return (await res.json()) as T;

    const limited = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
    if ((limited || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 - Date.now(); // epoch seconds on ClickUp and GitHub
      const wait = retryAfter > 0 ? retryAfter : reset > 0 && reset < 60_000 ? reset + 250 : 1500 * 2 ** attempt;
      if (wait > 60_000) throw new HttpError(`${o.label}: rate limit reached, try again in ${Math.ceil(wait / 60_000)} min`, 429);
      await sleep(wait);
      continue;
    }
    const text = (await res.text()).slice(0, 300);
    const hint = res.status === 401 ? " (the token was rejected: wrong, expired or revoked)" : res.status === 403 ? " (the token lacks permission)" : "";
    throw new HttpError(`${o.label} ${res.status}${hint}: ${text}`, res.status);
  }
}

// At most `n` calls running at once (ClickUp allows ~100 requests a minute).
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
