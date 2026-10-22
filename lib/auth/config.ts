// Sign-in configuration, all from environment variables.
//
//   AUTH_SECRET            turns sign-in ON (a long random string; also the key that encrypts stored ClickUp tokens).
//                          Without it the app runs in single-user "local" mode with CLICKUP_API_TOKEN, as in development.
//   AUTH_ALLOWED_EMAILS    OPTIONAL. Leave it empty and anyone with a ClickUp account can sign in (each person only ever
//                          sees their own ClickUp data, using their own token). Set a comma-separated list of emails to
//                          restrict the app to those people.
//   AUTH_GLOBAL_DAILY_CHATS  optional cap on AI questions per day across ALL people (default 1500), so open sign-up can
//                          never use up the shared AI quota.
//   CLICKUP_CLIENT_ID / CLICKUP_CLIENT_SECRET   enable the "Sign in with ClickUp" (OAuth) button. Without them only the
//                          personal-token option is offered.
//   APP_URL                optional public address, e.g. https://my-app.vercel.app (used for the OAuth redirect URL).
export const SESSION_COOKIE = "ca_session";
export const STATE_COOKIE = "ca_oauth_state";
export const SESSION_TTL_SEC = 30 * 24 * 3600;

export const authEnabled = () => !!process.env.AUTH_SECRET;
export const oauthEnabled = () => authEnabled() && !!process.env.CLICKUP_CLIENT_ID && !!process.env.CLICKUP_CLIENT_SECRET;

export const allowedEmails = () =>
  (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export type Allowed = { ok: true } | { ok: false; reason: "not_allowed" };
export function checkAllowed(email: string | null | undefined): Allowed {
  const list = allowedEmails();
  if (!list.length) return { ok: true }; // open sign-up: everyone signs in as themselves
  return list.includes(String(email ?? "").trim().toLowerCase()) ? { ok: true } : { ok: false, reason: "not_allowed" };
}

export const globalDailyChats = () => Math.max(1, Number(process.env.AUTH_GLOBAL_DAILY_CHATS) || 1500);

// The address ClickUp should send people back to. Prefer the configured one; otherwise trust the request's own host.
export function appOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

export const isSecure = (req: Request) => appOrigin(req).startsWith("https://");

// Only same-site relative paths are allowed as "where to go after login" (prevents open redirects).
export const safeNext = (next: string | null | undefined) => (next && /^\/(?!\/|\\)/.test(next) ? next : "/");
