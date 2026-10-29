import { checkOrigin } from "../auth/guard";
import { reportError } from "../observability";
import { cookieValue, resolveSession, SESSION_COOKIE } from "./auth";
import { runAsPlatform, type PlatformCtx, type Role } from "./context";

// Wraps an /api/cxo route: blocks cross-site requests, requires a platform session, checks the person's role in the
// workspace, and runs the route "as" them so every query is scoped to THEIR workspace. The workspace never comes
// from the request body or URL: only from the session.
const READ: Role[] = ["owner", "cxo", "manager"]; // developers get their own pages later; the CXO side is for these roles
const WRITE: Role[] = ["owner", "cxo"];

type Handler<A extends unknown[]> = (req: Request, ...rest: A) => Promise<Response> | Response;

export const platformSession = (req: Request): PlatformCtx | null => resolveSession(cookieValue(req.headers.get("cookie"), SESSION_COOKIE));

export function withPlatform<A extends unknown[]>(handler: Handler<A>, opts: { write?: boolean } = {}): Handler<A> {
  return async (req, ...rest) => {
    const blocked = checkOrigin(req);
    if (blocked) return blocked;
    const ctx = platformSession(req);
    if (!ctx) return Response.json({ error: "Please sign in.", platformSignIn: true }, { status: 401 });
    if (!(opts.write ? WRITE : READ).includes(ctx.role)) return Response.json({ error: "Your role does not allow this." }, { status: 403 });
    try {
      return await runAsPlatform(ctx, () => handler(req, ...rest));
    } catch (e) {
      const errorId = reportError(e, `api ${new URL(req.url).pathname}`);
      return Response.json({ error: "Something went wrong on our side. It has been reported.", errorId }, { status: 500 });
    }
  };
}
