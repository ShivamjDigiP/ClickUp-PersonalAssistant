import { isSecure, SESSION_COOKIE } from "@/lib/auth/config";
import { checkOrigin } from "@/lib/auth/guard";
import { cookieHeader, destroySession, sessionIdFrom } from "@/lib/auth/session";

// Ends the session on the server (so the stored token is deleted) and clears the cookie.
export async function POST(req: Request) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  await destroySession(sessionIdFrom(req)).catch(() => {});
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, "", { secure: isSecure(req), maxAge: 0 }));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
