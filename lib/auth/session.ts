import { randomBytes } from "node:crypto";
import { kv } from "../kv";
import { decrypt, encrypt } from "./crypto";
import { SESSION_COOKIE, SESSION_TTL_SEC } from "./config";

// A session is a random, unguessable id in a cookie; everything else lives in storage (never in the cookie).
// The person's ClickUp token is stored encrypted and only decrypted while a request is being served.
export type SessionUser = { userId: string; username: string; email: string; scheme: "raw" | "bearer" };
type Stored = SessionUser & { enc: string; createdAt: number };
export type Session = SessionUser & { token: string; createdAt: number };

const SID = /^[A-Za-z0-9_-]{43}$/;
const key = (sid: string) => `session/${sid}`;

export async function createSession(user: SessionUser & { token: string }): Promise<string> {
  const sid = randomBytes(32).toString("base64url"); // 43 characters
  const { token, ...rest } = user;
  const stored: Stored = { ...rest, enc: encrypt(token), createdAt: Date.now() };
  await kv().set(key(sid), stored, SESSION_TTL_SEC);
  return sid;
}

export async function getSession(sid: string | null | undefined): Promise<Session | null> {
  if (!sid || !SID.test(sid)) return null;
  const s = await kv().get<Stored>(key(sid));
  if (!s) return null;
  try {
    const { enc, ...rest } = s;
    return { ...rest, token: decrypt(enc) };
  } catch {
    return null; // wrong secret or tampered value: treat as signed out
  }
}

export const destroySession = async (sid: string | null | undefined) => {
  if (sid && SID.test(sid)) await kv().del(key(sid));
};

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const sessionIdFrom = (req: Request) => readCookie(req.headers.get("cookie"), SESSION_COOKIE);

export const cookieHeader = (name: string, value: string, opts: { secure: boolean; maxAge: number }) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${opts.maxAge}${opts.secure ? "; Secure" : ""}`;
