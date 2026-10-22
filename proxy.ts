import { NextResponse, type NextRequest } from "next/server";

// First gate for every request. When sign-in is on (AUTH_SECRET is set), anything except the sign-in page, the
// sign-in routes and the app's public files needs a session cookie, otherwise pages go to /login and API calls get 401.
// This only checks that a cookie exists; the API routes and pages validate it properly (lib/auth/guard.ts).
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
  if (!process.env.AUTH_SECRET) return NextResponse.next(); // single-user local mode
  const { pathname, search } = req.nextUrl;
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
