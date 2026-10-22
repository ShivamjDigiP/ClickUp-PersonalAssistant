import { appOrigin, checkAllowed, isSecure, oauthEnabled, safeNext, SESSION_COOKIE, SESSION_TTL_SEC, STATE_COOKIE } from "@/lib/auth/config";
import { exchangeCode, identify } from "@/lib/auth/clickupAuth";
import { cookieHeader, createSession, readCookie } from "@/lib/auth/session";
import { recordLogin } from "@/lib/auth/profile";
import { reportError } from "@/lib/observability";

// Step 2: ClickUp sends the person back here with a one-time `code`. We trade it for a token, find out who they are,
// check they are on the allow-list, then start a session.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const url = new URL(req.url);
  const fail = (code: string) => {
    const h = new Headers({ Location: `${origin}/login?error=${code}` });
    h.append("Set-Cookie", cookieHeader(STATE_COOKIE, "", { secure: isSecure(req), maxAge: 0 }));
    return new Response(null, { status: 302, headers: h });
  };

  if (!oauthEnabled()) return fail("oauth_unavailable");
  const code = url.searchParams.get("code");
  if (!code) return fail("cancelled"); // the person pressed "cancel" at ClickUp

  // The state cookie proves this browser started the sign-in. If ClickUp echoes `state` back it must match.
  const saved = readCookie(req.headers.get("cookie"), STATE_COOKIE);
  if (!saved) return fail("expired");
  const [state, nextB64] = saved.split("~");
  const echoed = url.searchParams.get("state");
  if (echoed && echoed !== state) return fail("state");

  try {
    const token = await exchangeCode(code);
    const who = await identify(token, "bearer");
    if (!who) return fail("rejected");

    const allowed = checkAllowed(who.user.email);
    if (!allowed.ok) return fail(allowed.reason);

    const sid = await createSession({ userId: who.user.id, username: who.user.username, email: who.user.email, scheme: who.scheme, token });
    await recordLogin({ userId: who.user.id, username: who.user.username, email: who.user.email }, "oauth").catch(() => {}); // never blocks sign-in
    const next = safeNext(nextB64 ? Buffer.from(nextB64, "base64url").toString() : "/");
    const headers = new Headers({ Location: `${origin}${next}` });
    const secure = isSecure(req);
    headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, sid, { secure, maxAge: SESSION_TTL_SEC }));
    headers.append("Set-Cookie", cookieHeader(STATE_COOKIE, "", { secure, maxAge: 0 }));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    reportError(e, "auth callback");
    return fail("failed");
  }
}
