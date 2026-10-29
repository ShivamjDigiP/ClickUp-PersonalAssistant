import { connection } from "next/server";
import { appOrigin, isSecure } from "@/lib/auth/config";
import { AuthError, cookieValue, createSession, sessionCookie, upsertGoogleUser } from "@/lib/platform/auth";
import { exchangeCode, googleEnabled, STATE_COOKIE } from "@/lib/platform/google";

export async function GET(req: Request) {
  await connection();
  const origin = appOrigin(req);
  const fail = (code: string) => Response.redirect(`${origin}/login?error=${code}`, 303);
  if (!googleEnabled()) return fail("google_unavailable");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookieValue(req.headers.get("cookie"), STATE_COOKIE);
  if (url.searchParams.get("error")) return fail("cancelled");
  if (!code || !state || !expected || state !== expected) return fail("state"); // not the sign-in this browser started

  try {
    const profile = await exchangeCode(origin, code);
    const { userId, workspaceId } = upsertGoogleUser(profile);
    const { token, expiresAt } = createSession(userId, workspaceId);
    const secure = isSecure(req);
    const headers = new Headers({ Location: `${origin}/cxo` });
    headers.append("Set-Cookie", sessionCookie(token, expiresAt, secure));
    headers.append("Set-Cookie", `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
    return new Response(null, { status: 303, headers });
  } catch (e) {
    return fail(e instanceof AuthError ? (e.code === "closed" || e.code === "domain" ? "not_allowed" : "failed") : "failed");
  }
}
