import { beforeEach, describe, expect, it, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  process.env.PLATFORM_DB = ":memory:";
  process.env.KV_BACKEND = "memory";
  delete process.env.PLATFORM_SIGNUP;
  delete process.env.PLATFORM_ALLOWED_EMAIL_DOMAINS;
  delete (globalThis as any).__platformDb;
  const auth = await import("../lib/platform/auth");
  const guard = await import("../lib/platform/guard");
  const store = await import("../lib/integrations/store");
  const dbm = await import("../lib/db");
  return { auth, guard, store, db: dbm.db };
}
const PW = "correct horse battery";
const req = (cookie?: string, init: RequestInit = {}) => new Request("http://localhost/api/cxo/x", { headers: cookie ? { cookie } : {}, ...init });

beforeEach(() => vi.restoreAllMocks());

describe("passwords", () => {
  it("hashes with a random salt and verifies only the right password", async () => {
    const { hashPassword, verifyPassword, passwordProblem } = await import("../lib/platform/password");
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).not.toBe(b); // different salts
    expect(a).not.toContain(PW);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword("wrong password!", a)).toBe(false);
    expect(await verifyPassword(PW, "garbage")).toBe(false);
    expect(await verifyPassword(PW, null)).toBe(false);
    expect(passwordProblem("short")).toMatch(/10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toBeTruthy();
    expect(passwordProblem(PW)).toBeNull();
  });
});

describe("sign up and sign in", () => {
  it("creates an owner with their own workspace and signs them in with the right password only", async () => {
    const { auth, db } = await fresh();
    const { userId, workspaceId } = await auth.signUp({ email: "  Boss@Acme.com ", name: "Boss", password: PW, workspaceName: "Acme Eng" });
    expect((db().prepare("SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?").get(userId, workspaceId) as any).role).toBe("owner");
    expect((db().prepare("SELECT email, password_hash FROM users WHERE id = ?").get(userId) as any).email).toBe("boss@acme.com");
    expect(await auth.authenticate("BOSS@acme.com", PW)).toMatchObject({ userId, workspaceId });
    expect(await auth.authenticate("boss@acme.com", "wrong wrong wrong")).toBeNull();
    expect(await auth.authenticate("nobody@acme.com", PW)).toBeNull();
  });

  it("rejects duplicate e-mails, bad e-mails and weak passwords", async () => {
    const { auth } = await fresh();
    await auth.signUp({ email: "a@b.co", name: "A", password: PW });
    await expect(auth.signUp({ email: "A@B.co", name: "A2", password: PW })).rejects.toMatchObject({ code: "taken" });
    await expect(auth.signUp({ email: "not-an-email", name: "A", password: PW })).rejects.toMatchObject({ code: "invalid" });
    await expect(auth.signUp({ email: "c@d.co", name: "C", password: "short" })).rejects.toMatchObject({ code: "weak" });
  });

  it("operator controls: closed sign-up and allowed domains", async () => {
    const { auth } = await fresh();
    process.env.PLATFORM_ALLOWED_EMAIL_DOMAINS = "acme.com";
    await expect(auth.signUp({ email: "x@other.com", name: "X", password: PW })).rejects.toMatchObject({ code: "domain" });
    await auth.signUp({ email: "ceo@acme.com", name: "CEO", password: PW });
    process.env.PLATFORM_SIGNUP = "closed";
    await expect(auth.signUp({ email: "cto@acme.com", name: "CTO", password: PW })).rejects.toMatchObject({ code: "closed" });
  });

  it("the first account adopts a workspace that was synced before accounts existed, so nothing is reconnected", async () => {
    const { auth, store, db } = await fresh();
    store.ensureWorkspace("ws_legacy", "Old");
    store.saveIntegration({ workspaceId: "ws_legacy", provider: "github", label: "GitHub", config: {}, secret: "ghp_abcdefgh" });
    const first = await auth.signUp({ email: "a@b.co", name: "A", password: PW, workspaceName: "Acme" });
    expect(first.workspaceId).toBe("ws_legacy");
    expect((db().prepare("SELECT name FROM workspaces WHERE id = 'ws_legacy'").get() as any).name).toBe("Acme");
    const second = await auth.signUp({ email: "c@d.co", name: "C", password: PW });
    expect(second.workspaceId).not.toBe("ws_legacy"); // later accounts never inherit someone else's data
  });
});

describe("sessions", () => {
  it("stores only a hash of the token, expires, and can be destroyed", async () => {
    const { auth, db } = await fresh();
    const { userId, workspaceId } = await auth.signUp({ email: "a@b.co", name: "A", password: PW });
    const { token } = auth.createSession(userId, workspaceId, 1_000);
    expect(JSON.stringify(db().prepare("SELECT * FROM sessions").all())).not.toContain(token);
    expect(auth.resolveSession(token, 2_000)).toMatchObject({ userId, workspaceId, role: "owner", email: "a@b.co" });
    expect(auth.resolveSession(token, 1_000 + auth.SESSION_TTL_MS + 1)).toBeNull(); // expired
    expect(auth.resolveSession(token, 2_000)).toBeNull(); // and the expired row is gone
    const again = auth.createSession(userId, workspaceId).token;
    auth.destroySession(again);
    expect(auth.resolveSession(again)).toBeNull();
    expect(auth.resolveSession("x".repeat(43))).toBeNull();
    expect(auth.resolveSession(null)).toBeNull();
  });

  it("cookies are HttpOnly, SameSite, and Secure when served over https", async () => {
    const { auth } = await fresh();
    const c = auth.sessionCookie("tok", Date.now() + 1000, true);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Secure/);
    expect(auth.sessionCookie("tok", Date.now() + 1000, false)).not.toMatch(/Secure/);
    expect(auth.cookieValue("a=1; px_session=abc%2Fdef; b=2", "px_session")).toBe("abc/def");
  });
});

describe("withPlatform guard", () => {
  const ok = async () => Response.json({ ok: true });

  it("refuses requests with no session or a forged one", async () => {
    const { guard } = await fresh();
    const h = guard.withPlatform(ok);
    expect((await h(req())).status).toBe(401);
    expect((await h(req("px_session=" + "f".repeat(43)))).status).toBe(401);
  });

  it("lets a signed-in owner through and scopes the request to their own workspace", async () => {
    const { auth, guard } = await fresh();
    const { requirePlatform } = await import("../lib/platform/context");
    const a = await auth.signUp({ email: "a@b.co", name: "A", password: PW });
    const b = await auth.signUp({ email: "c@d.co", name: "C", password: PW });
    const seen: string[] = [];
    const h = guard.withPlatform(async () => (seen.push(requirePlatform().workspaceId), Response.json({ ok: true })));
    const ta = auth.createSession(a.userId, a.workspaceId).token;
    const tb = auth.createSession(b.userId, b.workspaceId).token;
    await h(req(`px_session=${ta}`));
    await h(req(`px_session=${tb}`));
    expect(seen).toEqual([a.workspaceId, b.workspaceId]);
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it("blocks developers from the CXO side, and managers from changing things", async () => {
    const { auth, guard, db } = await fresh();
    const { userId, workspaceId } = await auth.signUp({ email: "a@b.co", name: "A", password: PW });
    const t = auth.createSession(userId, workspaceId).token;
    const cookie = `px_session=${t}`;
    db().prepare("UPDATE memberships SET role = 'manager' WHERE user_id = ?").run(userId);
    expect((await guard.withPlatform(ok)(req(cookie))).status).toBe(200);
    expect((await guard.withPlatform(ok, { write: true })(req(cookie))).status).toBe(403);
    db().prepare("UPDATE memberships SET role = 'developer' WHERE user_id = ?").run(userId);
    expect((await guard.withPlatform(ok)(req(cookie))).status).toBe(403);
  });

  it("refuses a cross-site POST even with a valid session", async () => {
    const { auth, guard } = await fresh();
    const { userId, workspaceId } = await auth.signUp({ email: "a@b.co", name: "A", password: PW });
    const t = auth.createSession(userId, workspaceId).token;
    const r = await guard.withPlatform(ok, { write: true })(new Request("http://localhost/api/cxo/x", { method: "POST", headers: { cookie: `px_session=${t}`, origin: "https://evil.example", host: "localhost" } }));
    expect(r.status).toBe(403);
  });
});

describe("integrations persist per workspace", () => {
  it("keeps a connected tool after sign-out and sign-in, and never shows it to another workspace", async () => {
    const { auth, store } = await fresh();
    const a = await auth.signUp({ email: "a@b.co", name: "A", password: PW });
    const b = await auth.signUp({ email: "c@d.co", name: "C", password: PW });
    const id = store.saveIntegration({ workspaceId: a.workspaceId, provider: "clickup", label: "ClickUp", config: {}, secret: "pk_secret_token" });
    const t = auth.createSession(a.userId, a.workspaceId).token;
    auth.destroySession(t); // sign out
    const again = await auth.authenticate("a@b.co", PW); // sign back in later
    expect(store.listIntegrations(again!.workspaceId).map((i) => i.id)).toEqual([id]); // still connected: no repeat setup
    expect(store.listIntegrations(b.workspaceId)).toEqual([]);
    expect(store.getIntegration(id, b.workspaceId)).toBeNull();
  });
});
