import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sign-in is exercised with the in-memory store and a fake ClickUp, never real storage or the real API.
process.env.KV_BACKEND = "memory";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";

import { decrypt, encrypt } from "../lib/auth/crypto";
import { checkAllowed, safeNext } from "../lib/auth/config";
import { authKey, ns, runAs } from "../lib/auth/context";
import { createSession, destroySession, getSession, readCookie } from "../lib/auth/session";
import { checkOrigin, withAuth } from "../lib/auth/guard";
import { identify } from "../lib/auth/clickupAuth";
import { limit } from "../lib/ratelimit";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AUTH_ALLOWED_EMAILS;
});

describe("token encryption", () => {
  it("round-trips and never stores plain text", () => {
    const blob = encrypt("pk_12345_SECRET");
    expect(blob).not.toContain("SECRET");
    expect(decrypt(blob)).toBe("pk_12345_SECRET");
  });
  it("uses a fresh random IV each time", () => expect(encrypt("same")).not.toBe(encrypt("same")));
  it("detects tampering", () => {
    const [v, iv, tag, data] = encrypt("pk_abc").split(".");
    const bad = [v, iv, tag, Buffer.from("zzzzzzzz").toString("base64url") + data.slice(8)].join(".");
    expect(() => decrypt(bad)).toThrow();
  });
  it("cannot be read with a different secret", () => {
    const blob = encrypt("pk_abc");
    const old = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-another-secret-another-1";
    expect(() => decrypt(blob)).toThrow();
    process.env.AUTH_SECRET = old;
  });
});

describe("allow-list (optional)", () => {
  it("is open to everyone when no emails are configured", () => {
    expect(checkAllowed("anyone@x.com").ok).toBe(true);
    expect(checkAllowed("").ok).toBe(true);
  });
  it("restricts to the listed emails once configured, ignoring case and spaces", () => {
    process.env.AUTH_ALLOWED_EMAILS = " Me@X.com , you@y.com ";
    expect(checkAllowed("me@x.com").ok).toBe(true);
    expect(checkAllowed("YOU@y.com").ok).toBe(true);
    expect(checkAllowed("evil@z.com")).toEqual({ ok: false, reason: "not_allowed" });
    expect(checkAllowed(undefined).ok).toBe(false);
  });
});

describe("safeNext (no open redirects)", () => {
  it("keeps same-site paths and rejects everything else", () => {
    expect(safeNext("/imported-from-jira?status=backlog")).toBe("/imported-from-jira?status=backlog");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined]) expect(safeNext(bad as string)).toBe("/");
  });
});

describe("sessions", () => {
  it("creates, reads and destroys a session, keeping the token encrypted at rest", async () => {
    const sid = await createSession({ userId: "42", username: "Asha", email: "a@x.com", scheme: "raw", token: "pk_SECRET_TOKEN" });
    expect(sid).toHaveLength(43);
    const s = await getSession(sid);
    expect(s).toMatchObject({ userId: "42", email: "a@x.com", token: "pk_SECRET_TOKEN" });
    const { kv } = await import("../lib/kv");
    expect(JSON.stringify(await kv().get(`session/${sid}`))).not.toContain("SECRET_TOKEN");
    await destroySession(sid);
    expect(await getSession(sid)).toBeNull();
  });
  it("rejects malformed ids without touching storage", async () => {
    for (const bad of [null, "", "short", "../../etc/passwd", "x".repeat(43) + "!"]) expect(await getSession(bad)).toBeNull();
  });
  it("reads cookies", () => expect(readCookie("a=1; ca_session=abc%20d; b=2", "ca_session")).toBe("abc d"));
});

describe("per-person isolation", () => {
  it("namespaces storage keys by person, and keeps legacy keys in local mode", () => {
    expect(ns("settings")).toBe("settings");
    runAs({ userId: "7", token: "t", scheme: "raw" }, () => {
      expect(ns("settings")).toBe("u/7/settings");
      expect(authKey()).toBe("7");
    });
    runAs({ userId: "local", token: "t", scheme: "raw" }, () => expect(ns("settings")).toBe("settings"));
  });
});

describe("profiles and chat history per person", () => {
  const A = { userId: "1001", token: "ta", scheme: "raw" as const };
  const B = { userId: "1002", token: "tb", scheme: "raw" as const };
  const chat = (id: string, q: string) => ({ id, bubbles: [{ role: "user", text: q }], history: [], outcomes: {} });
  const ID_A = "aaaaaaaa-0000-0000-0000-000000000001";

  it("remembers a person across sign-ins without storing any token", async () => {
    const { recordLogin, getProfile } = await import("../lib/auth/profile");
    await recordLogin({ userId: "55", username: "Asha", email: "a@x.com" }, "token");
    const second = await recordLogin({ userId: "55", username: "Asha", email: "a@x.com" }, "oauth");
    expect(second.logins).toBe(2);
    expect(second.firstSeen <= second.lastLogin).toBe(true);
    expect(JSON.stringify(await getProfile("55"))).not.toMatch(/token":"|pk_/);
  });

  it("returns each person's own chats when they come back, and never anyone else's", async () => {
    const { saveChat, listChats, getChat } = await import("../lib/chats");
    await runAs(A, () => saveChat(chat(ID_A, "Asha's private question")));
    const mine = await runAs(A, () => listChats());
    expect(mine.map((c) => c.title)).toEqual(["Asha's private question"]);
    expect(await runAs(B, () => listChats())).toEqual([]); // another person sees nothing
    expect(await runAs(B, () => getChat(ID_A))).toBeNull(); // not even by guessing the id
    expect((await runAs(A, () => getChat(ID_A)))?.title).toBe("Asha's private question"); // still there next time
  });
});

describe("cross-site request protection", () => {
  const req = (method: string, headers: Record<string, string>) => new Request("https://app.example/api/x", { method, headers: { host: "app.example", ...headers } });
  it("lets reads through and same-origin writes through", () => {
    expect(checkOrigin(req("GET", { origin: "https://evil.com" }))).toBeNull();
    expect(checkOrigin(req("POST", { origin: "https://app.example" }))).toBeNull();
    expect(checkOrigin(req("POST", {}))).toBeNull(); // non-browser clients send no Origin
  });
  it("blocks writes from another site", async () => {
    expect((await checkOrigin(req("POST", { origin: "https://evil.com" })))?.status).toBe(403);
    expect((await checkOrigin(req("POST", { "sec-fetch-site": "cross-site" })))?.status).toBe(403);
  });
});

describe("withAuth", () => {
  const handler = withAuth(async () => Response.json({ who: authKey() }));
  it("answers 401 without a session", async () => {
    const res = await handler(new Request("https://app.example/api/x", { headers: { host: "app.example" } }));
    expect(res.status).toBe(401);
  });
  it("turns a crash into a calm 500 with a reference id, never a stack trace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sid = await createSession({ userId: "77", username: "Neha", email: "n@x.com", scheme: "raw", token: "tok" });
    const crashing = withAuth(async () => {
      throw new Error("kaboom at /secret/internal/path.ts:42");
    });
    const res = await crashing(new Request("https://app.example/api/boom", { headers: { host: "app.example", cookie: `ca_session=${sid}` } }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/reported/i);
    expect(JSON.stringify(body)).not.toMatch(/kaboom|secret\/internal|\.ts:42/);
    expect(body).toHaveProperty("errorId");
  });
  it("runs the route as the signed-in person", async () => {
    const sid = await createSession({ userId: "99", username: "Ravi", email: "r@x.com", scheme: "bearer", token: "tok" });
    const res = await handler(new Request("https://app.example/api/x", { headers: { host: "app.example", cookie: `ca_session=${sid}` } }));
    expect(await res.json()).toEqual({ who: "99" });
  });
});

describe("identify (token check)", () => {
  const user = { user: { id: 5, username: "Asha", email: "a@x.com" } };
  it("accepts a valid personal token as-is", async () => {
    const f = vi.fn(async (_u: string, init: { headers: { Authorization: string } }) =>
      init.headers.Authorization === "pk_good_token_12345678901" ? new Response(JSON.stringify(user)) : new Response("{}", { status: 401 }),
    );
    vi.stubGlobal("fetch", f);
    expect(await identify("pk_good_token_12345678901", "raw")).toMatchObject({ scheme: "raw", user: { id: "5", email: "a@x.com" } });
  });
  it("falls back from Bearer to raw for OAuth tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { headers: { Authorization: string } }) => (init.headers.Authorization.startsWith("Bearer") ? new Response("{}", { status: 401 }) : new Response(JSON.stringify(user)))));
    expect((await identify("oauth_token_value_1234567", "bearer"))?.scheme).toBe("raw");
  });
  it("returns null when ClickUp rejects the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect(await identify("pk_bad_token_1234567890123", "raw")).toBeNull();
  });
});

describe("rate limit", () => {
  beforeEach(() => vi.useRealTimers());
  it("allows up to the limit, then blocks", async () => {
    const key = `t${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await limit(key, 3, 60)).ok).toBe(true);
    expect((await limit(key, 3, 60)).ok).toBe(false);
  });
});
