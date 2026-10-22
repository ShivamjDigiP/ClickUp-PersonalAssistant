import { kv } from "./kv";

// "Is the app able to do its job?" Used by /api/health, which uptime monitors (and you) can call.
export type Health = {
  status: "ok" | "degraded" | "down";
  version: string;
  time: string;
  storage: { ok: boolean; backend: "redis" | "file" | "memory"; ms: number; note?: string };
};

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`storage timed out after ${ms}ms`)), ms))]);

export async function checkHealth(): Promise<Health> {
  const store = kv();
  const started = Date.now();
  const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  let storage: Health["storage"] = { ok: true, backend: store.kind, ms: 0 };

  try {
    // a real round trip: write, read back, delete
    const probe = `${Date.now()}`;
    await withTimeout(store.set("health/ping", { probe }, 60), 3000);
    const back = await withTimeout(store.get<{ probe: string }>("health/ping"), 3000);
    await withTimeout(store.del("health/ping"), 3000);
    if (back?.probe !== probe) throw new Error("storage did not return what was written");
    storage = { ok: true, backend: store.kind, ms: Date.now() - started };
    // Memory on a serverless host means Redis is not configured: nothing is remembered reliably.
    if (store.kind === "memory" && serverless) {
      storage = { ...storage, ok: false, note: "No Redis configured: settings, chats and approvals are not saved reliably." };
    }
  } catch (e) {
    storage = { ok: false, backend: store.kind, ms: Date.now() - started, note: (e as Error).message };
  }

  return {
    status: storage.ok ? "ok" : storage.note?.startsWith("No Redis") ? "degraded" : "down",
    version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7),
    time: new Date().toISOString(),
    storage,
  };
}
