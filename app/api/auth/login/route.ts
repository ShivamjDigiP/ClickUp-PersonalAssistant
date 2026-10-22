import { randomBytes } from "node:crypto";
import { appOrigin, isSecure, oauthEnabled, safeNext, STATE_COOKIE } from "@/lib/auth/config";
import { authorizeUrl } from "@/lib/auth/clickupAuth";
import { cookieHeader } from "@/lib/auth/session";

// Step 1 of "Sign in with ClickUp": remember a one-time `state` value in a cookie, then send the person to ClickUp.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  if (!oauthEnabled()) return Response.redirect(`${origin}/login?error=oauth_unavailable`, 302);

  const state = randomBytes(16).toString("base64url");
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const headers = new Headers({ Location: authorizeUrl(`${origin}/api/auth/callback`, state) });
  headers.append(
    "Set-Cookie",
    cookieHeader(STATE_COOKIE, `${state}~${Buffer.from(next).toString("base64url")}`, { secure: isSecure(req), maxAge: 600 }),
  );
  return new Response(null, { status: 302, headers });
}
