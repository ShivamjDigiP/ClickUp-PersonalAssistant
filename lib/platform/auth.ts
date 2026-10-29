import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, tx } from "../db";
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from "./password";
import type { PlatformCtx, Role } from "./context";

// Platform accounts and sessions. ClickUp is NOT involved here: it is only a data source a workspace connects later.
export const SESSION_COOKIE = "px_session";
export const SESSION_TTL_MS = 30 * 86_400_000;

export class AuthError extends Error {
  constructor(message: string, public code: "invalid" | "taken" | "closed" | "weak" | "domain") {
    super(message);
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Operator controls (environment): PLATFORM_SIGNUP=closed allows only the very first account;
// PLATFORM_ALLOWED_EMAIL_DOMAINS=acme.com,acme.io limits sign-up to those domains.
function checkSignupAllowed(email: string, userCount: number) {
  if (process.env.PLATFORM_SIGNUP === "closed" && userCount > 0) throw new AuthError("Sign-up is closed. Ask your administrator for access.", "closed");
  const domains = (process.env.PLATFORM_ALLOWED_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (domains.length && !domains.includes(email.split("@")[1])) throw new AuthError("This e-mail domain is not allowed to sign up.", "domain");
}

// The first account on a machine adopts the workspace that was synced before accounts existed (data from the
// ClickUp-login days), so nothing has to be connected or downloaded again.
function legacyWorkspace(): string | null {
  const row = db()
    .prepare(
      `SELECT w.id FROM workspaces w
       WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id)
         AND EXISTS (SELECT 1 FROM integrations i WHERE i.workspace_id = w.id)
       ORDER BY (SELECT COUNT(*) FROM tasks t WHERE t.workspace_id = w.id) DESC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

export async function signUp(input: { email: string; name: string; password: string; workspaceName?: string }): Promise<{ userId: string; workspaceId: string }> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!EMAIL.test(email) || email.length > 200) throw new AuthError("Enter a valid e-mail address.", "invalid");
  if (name.length < 1 || name.length > 80) throw new AuthError("Enter your name.", "invalid");
  const weak = passwordProblem(input.password);
  if (weak) throw new AuthError(weak, "weak");

  const d = db();
  const userCount = (d.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  checkSignupAllowed(email, userCount);
  const hash = await hashPassword(input.password); // slow on purpose: done before the transaction

  return tx(() => {
    if (d.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new AuthError("An account with this e-mail already exists. Sign in instead.", "taken");
    const now = Date.now();
    const userId = randomUUID();
    d.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, email, name, hash, now);

    const title = input.workspaceName?.trim().slice(0, 80) || `${name}'s workspace`;
    let workspaceId = userCount === 0 ? legacyWorkspace() : null;
    if (workspaceId) d.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(title, workspaceId);
    else {
      workspaceId = `ws_${randomBytes(8).toString("hex")}`;
      d.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(workspaceId, title, now);
    }
    d.prepare("INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(userId, workspaceId, now);
    return { userId, workspaceId };
  });
}

export async function authenticate(emailRaw: string, password: string): Promise<{ userId: string; workspaceId: string } | null> {
  const email = normalizeEmail(emailRaw);
  const user = db().prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as { id: string; password_hash: string | null } | undefined;
  // verify against a dummy hash when there is no such user, so timing does not reveal which e-mails have accounts
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash()));
  if (!user || !user.password_hash || !ok) return null;
  const m = db().prepare("SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1").get(user.id) as { workspace_id: string } | undefined;
  if (!m) return null;
  db().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now(), user.id);
  return { userId: user.id, workspaceId: m.workspace_id };
}

export function createSession(userId: string, workspaceId: string, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  db().prepare("INSERT INTO sessions (id_hash, user_id, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(sha(token), userId, workspaceId, now, expiresAt);
  return { token, expiresAt };
}

export function resolveSession(token: string | null | undefined, now = Date.now()): PlatformCtx | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const row = db()
    .prepare(
      `SELECT s.expires_at, s.user_id, s.workspace_id, u.name, u.email, m.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
       WHERE s.id_hash = ?`,
    )
    .get(sha(token)) as { expires_at: number; user_id: string; workspace_id: string; name: string; email: string; role: Role } | undefined;
  if (!row) return null;
  if (row.expires_at <= now) {
    destroySession(token);
    return null;
  }
  return { userId: row.user_id, workspaceId: row.workspace_id, role: row.role, name: row.name, email: row.email };
}

export const destroySession = (token: string) => void db().prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha(token));

export function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const sessionCookie = (token: string, expiresAt: number, secure: boolean) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure ? "; Secure" : ""}`;
export const clearCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

// Google sign-in: link to an existing account with the same verified e-mail, or create one.
export function upsertGoogleUser(profile: { sub: string; email: string; name: string }): { userId: string; workspaceId: string } {
  const d = db();
  const email = normalizeEmail(profile.email);
  const existing = (d.prepare("SELECT id FROM users WHERE google_sub = ?").get(profile.sub) ?? d.prepare("SELECT id FROM users WHERE email = ?").get(email)) as { id: string } | undefined;
  return tx(() => {
    const now = Date.now();
    let userId = existing?.id;
    if (userId) d.prepare("UPDATE users SET google_sub = COALESCE(google_sub, ?), last_login_at = ? WHERE id = ?").run(profile.sub, now, userId);
    else {
      const count = (d.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
      checkSignupAllowed(email, count);
      userId = randomUUID();
      d.prepare("INSERT INTO users (id, email, name, google_sub, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)").run(userId, email, profile.name.trim().slice(0, 80) || email, profile.sub, now, now);
      let ws = count === 0 ? legacyWorkspace() : null;
      if (!ws) {
        ws = `ws_${randomBytes(8).toString("hex")}`;
        d.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(ws, `${profile.name.trim() || email}'s workspace`, now);
      }
      d.prepare("INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(userId, ws, now);
    }
    const m = d.prepare("SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1").get(userId) as { workspace_id: string };
    return { userId, workspaceId: m.workspace_id };
  });
}
