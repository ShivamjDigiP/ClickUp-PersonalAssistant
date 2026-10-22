import { authEnabled, checkAllowed, isSecure, SESSION_COOKIE, SESSION_TTL_SEC } from "@/lib/auth/config";
import { identify } from "@/lib/auth/clickupAuth";
import { checkOrigin } from "@/lib/auth/guard";
import { cookieHeader, createSession } from "@/lib/auth/session";
import { recordLogin } from "@/lib/auth/profile";
import { reportError } from "@/lib/observability";
import { clientIp, limit } from "@/lib/ratelimit";

// Secondary sign-in: paste a ClickUp personal API token. We check it with ClickUp, make sure that person is on the
// allow-list, and keep it ENCRYPTED. It is never logged and never sent back to the browser.
export async function POST(req: Request) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  if (!authEnabled()) return Response.json({ error: "Sign-in is not turned on for this app." }, { status: 404 });

  // Brute-force guard: a handful of attempts per address every 10 minutes
  const rl = await limit(`login/${clientIp(req)}`, 8, 600);
  if (!rl.ok) {
    return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length < 20 || token.length > 200 || /\s/.test(token)) {
    return Response.json({ error: "That doesn't look like a ClickUp API token. It starts with pk_ and has no spaces." }, { status: 400 });
  }

  try {
    const who = await identify(token, "raw"); // personal tokens are sent as-is
    if (!who) return Response.json({ error: "ClickUp did not accept that token. Copy it again from ClickUp → Settings → Apps." }, { status: 401 });

    // Only restricts when the owner has set AUTH_ALLOWED_EMAILS; otherwise everyone signs in as themselves
    if (!checkAllowed(who.user.email).ok) {
      return Response.json({ error: "This ClickUp account is not on the list of people allowed to use this app." }, { status: 403 });
    }

    const sid = await createSession({ userId: who.user.id, username: who.user.username, email: who.user.email, scheme: who.scheme, token });
    await recordLogin({ userId: who.user.id, username: who.user.username, email: who.user.email }, "token").catch(() => {}); // never blocks sign-in
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, sid, { secure: isSecure(req), maxAge: SESSION_TTL_SEC }));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    reportError(e, "auth token sign-in"); // the message never contains the token
    return Response.json({ error: "Could not reach ClickUp to check the token. Try again." }, { status: 502 });
  }
}
