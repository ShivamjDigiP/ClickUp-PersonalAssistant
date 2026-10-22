import { cookies } from "next/headers";
import { authEnabled, SESSION_COOKIE } from "./config";
import { runAs, type AuthCtx } from "./context";
import { getSession, sessionIdFrom } from "./session";
import { reportError, setReportingUser } from "../observability";

// Defends against other websites making your browser send requests to this app (CSRF).
// Browsers always say where a request came from; if it came from somewhere else, refuse it.
export function checkOrigin(req: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return null;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin");
  const forbidden = () => Response.json({ error: "Request blocked: it did not come from this app." }, { status: 403 });
  if (origin) {
    try {
      return new URL(origin).host === host ? null : forbidden();
    } catch {
      return forbidden();
    }
  }
  const site = req.headers.get("sec-fetch-site");
  return site && !["same-origin", "none"].includes(site) ? forbidden() : null;
}

const localCtx = (): AuthCtx => ({ userId: "local", token: process.env.CLICKUP_API_TOKEN ?? "", scheme: "raw" });

type Handler<A extends unknown[]> = (req: Request, ...rest: A) => Promise<Response> | Response;

// Wraps an API route: blocks cross-site requests, requires a signed-in person (when sign-in is on), and runs the route
// "as" that person so every ClickUp call and every stored item automatically belongs to them.
export function withAuth<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (req, ...rest) => {
    const blocked = checkOrigin(req);
    if (blocked) return blocked;
    let ctx: AuthCtx;
    if (!authEnabled()) ctx = localCtx();
    else {
      const s = await getSession(sessionIdFrom(req)).catch(() => null);
      if (!s) return Response.json({ error: "Please sign in.", signIn: true }, { status: 401 });
      ctx = { userId: s.userId, token: s.token, scheme: s.scheme, email: s.email, name: s.username };
      setReportingUser(ctx.userId);
    }
    // Anything a route throws is reported and answered with a clear message, never a blank 500 page.
    try {
      return await runAs(ctx, () => handler(req, ...rest));
    } catch (e) {
      const errorId = reportError(e, `api ${new URL(req.url).pathname}`);
      return Response.json({ error: "Something went wrong on our side. It has been reported.", errorId }, { status: 500 });
    }
  };
}

// The same idea for server-rendered pages: returns who is signed in (or null) from the cookie.
export async function pageAuth(): Promise<AuthCtx | null> {
  if (!authEnabled()) return localCtx();
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await getSession(sid).catch(() => null);
  return s ? { userId: s.userId, token: s.token, scheme: s.scheme, email: s.email, name: s.username } : null;
}
