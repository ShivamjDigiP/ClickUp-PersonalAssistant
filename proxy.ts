import { NextResponse, type NextRequest } from "next/server";

// First gate for every request. This only checks that a session cookie exists; the API routes and pages validate it
// properly (lib/auth/guard.ts for the personal ClickUp assistant, lib/platform/guard.ts for the CXO platform).
//
// Two separate sign-ins live here:
//  - the CXO platform (/cxo, /api/cxo, /api/platform): its own accounts, cookie "px_session", ALWAYS enforced;
//  - the personal ClickUp assistant (everything else): ClickUp sign-in, cookie "ca_session", enforced when AUTH_SECRET is set.
const PLATFORM_PUBLIC = [/^\/cxo\/(login|signup)(\/|$)/, /^\/api\/platform\/(login|signup|logout|me|google)(\/|$)/];
const PLATFORM = /^\/(cxo|api\/cxo|api\/platform)(\/|$)/;

const PUBLIC = [
  /^\/login(\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/health$/, // uptime monitors cannot sign in
  /^\/api\/cron\//, // the scheduler cannot sign in; these routes check a secret instead
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/offline(\/|$)/,
  /^\/pwa-(icon|splash)\//,
  /^\/icon/,
  /^\/favicon\.ico$/,
  /^\/debug-viewport(\/|$)/,
];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PLATFORM.test(pathname)) {
    if (PLATFORM_PUBLIC.some((r) => r.test(pathname)) || req.cookies.has("px_session")) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in.", platformSignIn: true }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (!process.env.AUTH_SECRET) return NextResponse.next(); // single-user local mode
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (req.cookies.has("ca_session")) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in.", signIn: true }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
