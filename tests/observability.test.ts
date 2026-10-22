import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_COLLECTION, IGNORED_ERRORS, scrubEvent, scrubText } from "../lib/sentryScrub";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("../lib/kv");
  vi.doUnmock("@sentry/nextjs");
});

const ignored = (msg: string) => IGNORED_ERRORS.some((p) => (typeof p === "string" ? msg.includes(p) : p.test(msg)));

describe("what leaves the app in an error report", () => {
  it("removes cookies, headers, request bodies and query strings", () => {
    const e = scrubEvent({
      request: { url: "https://app/api/chat", headers: { authorization: "pk_123", cookie: "ca_session=abc" }, cookies: { a: "1" }, data: { q: "secret task name" }, query_string: "token=1" },
    });
    expect(e.request).toEqual({ url: "https://app/api/chat" });
  });
  it("keeps only the user id, never name, email or address", () => {
    const e = scrubEvent({ user: { id: "42", email: "a@x.com", username: "Asha", ip_address: "1.2.3.4" } });
    expect(e.user).toEqual({ id: "42" });
    expect(scrubEvent({ user: { email: "a@x.com" } }).user).toBeUndefined();
  });
  it("redacts ClickUp tokens inside messages, exceptions and breadcrumbs", () => {
    const e = scrubEvent({
      message: "failed with pk_10689_ABCDEFGHIJKLMNOP",
      exception: { values: [{ value: "401 for Bearer abcdefghijklmnopqrstuvwxyz" }] },
      breadcrumbs: [{ message: "GET with pk_1_SECRETSECRET", data: { url: "https://api.clickup.com/x?token=1" } }],
      extra: { history: ["private chat"] },
    });
    expect(JSON.stringify(e)).not.toMatch(/pk_10689|ABCDEFGH|abcdefghijklmnop|SECRETSECRET|private chat|token=1/);
    expect(e.message).toContain("[redacted]");
  });
  it("scrubText leaves normal text alone", () => expect(scrubText("Imported from Jira: 306 of 320 done")).toBe("Imported from Jira: 306 of 320 done"));
  it("switches every Sentry data-collection option off", () => {
    expect(DATA_COLLECTION).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false });
  });
});

describe("expected errors are not reported", () => {
  it.each(["ClickUp 401: token revoked", "ClickUp 404: List not found", "ClickUp 429: slow down", "Please sign in.", "The operation was aborted", "Failed to fetch", "Daily quota exhausted for gemini"])("ignores %s", (m) => expect(ignored(m)).toBe(true));
  it.each(["TypeError: Cannot read properties of undefined", "ClickUp 500: server error", "Storage error: WRONGPASS"])("still reports %s", (m) => expect(ignored(m)).toBe(false));
});

describe("health check", () => {
  it("is ok when storage round-trips", async () => {
    vi.stubEnv("KV_BACKEND", "memory");
    const { checkHealth } = await import("../lib/healthcheck");
    const h = await checkHealth();
    expect(h).toMatchObject({ status: "ok", storage: { ok: true, backend: "memory" } });
    expect(Object.keys(h).sort()).toEqual(["status", "storage", "time", "version"]); // nothing sensitive
  });
  it("is degraded on a serverless host that has no Redis", async () => {
    vi.stubEnv("KV_BACKEND", "memory");
    vi.stubEnv("VERCEL", "1");
    const { checkHealth } = await import("../lib/healthcheck");
    const h = await checkHealth();
    expect(h.status).toBe("degraded");
    expect(h.storage.note).toMatch(/No Redis/);
  });
  it("is down when storage fails", async () => {
    vi.doMock("../lib/kv", () => ({ kv: () => ({ kind: "redis", set: async () => { throw new Error("Storage error: WRONGPASS"); }, get: async () => null, del: async () => {} }) }));
    const { checkHealth } = await import("../lib/healthcheck");
    const h = await checkHealth();
    expect(h.status).toBe("down");
    expect(h.storage).toMatchObject({ ok: false, note: "Storage error: WRONGPASS" });
  });
});

describe("reportError", () => {
  it("sends the error with a 'where' tag and never throws", async () => {
    const tags: Record<string, string> = {};
    const captured: unknown[] = [];
    vi.doMock("@sentry/nextjs", () => ({
      withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => unknown) => fn({ setTag: (k, v) => void (tags[k] = v) }),
      captureException: (e: unknown) => (captured.push(e), "evt123"),
      getIsolationScope: () => ({ setUser: () => {} }),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { reportError } = await import("../lib/observability");
    const err = new Error("boom");
    expect(reportError(err, "api/test")).toBe("evt123");
    expect(captured).toEqual([err]);
    expect(tags.where).toBe("api/test");
  });
  it("survives Sentry itself failing", async () => {
    vi.doMock("@sentry/nextjs", () => ({ withScope: () => { throw new Error("sentry down"); } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { reportError } = await import("../lib/observability");
    expect(reportError(new Error("x"), "api/test")).toBeUndefined();
  });
});
