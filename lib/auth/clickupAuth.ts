// Talking to ClickUp for sign-in: checking a token, and the OAuth code exchange.
const API = "https://api.clickup.com/api/v2";

export type ClickUpUser = { id: string; username: string; email: string };
export type Scheme = "raw" | "bearer";

export const authHeader = (token: string, scheme: Scheme) => (scheme === "bearer" ? `Bearer ${token}` : token);

// Returns the person behind a token, or null when ClickUp rejects it. Network problems throw.
export async function fetchUser(token: string, scheme: Scheme): Promise<ClickUpUser | null> {
  const res = await fetch(`${API}/user`, { headers: { Authorization: authHeader(token, scheme) }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`ClickUp answered ${res.status}`);
  const { user } = (await res.json()) as { user?: { id: number | string; username?: string; email?: string } };
  if (!user?.id) return null;
  return { id: String(user.id), username: String(user.username ?? "ClickUp user"), email: String(user.email ?? "") };
}

// OAuth tokens are documented as "Authorization: Bearer <token>"; if ClickUp ever wants the bare token we detect that here.
export async function identify(token: string, preferred: Scheme): Promise<{ user: ClickUpUser; scheme: Scheme } | null> {
  const order: Scheme[] = preferred === "bearer" ? ["bearer", "raw"] : ["raw", "bearer"];
  for (const scheme of order) {
    const user = await fetchUser(token, scheme);
    if (user) return { user, scheme };
  }
  return null;
}

// Trades the one-time `code` from the redirect for an access token.
export async function exchangeCode(code: string): Promise<string> {
  const body = { client_id: process.env.CLICKUP_CLIENT_ID, client_secret: process.env.CLICKUP_CLIENT_SECRET, code };
  let res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 400 || res.status === 415) {
    // Some ClickUp docs show the parameters in the query string instead of a JSON body: try that once.
    const qs = new URLSearchParams(body as Record<string, string>).toString();
    res = await fetch(`${API}/oauth/token?${qs}`, { method: "POST", cache: "no-store" });
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; err?: string };
  if (!res.ok || !data.access_token) throw new Error(data.err ?? `ClickUp did not accept the sign-in code (HTTP ${res.status})`);
  return data.access_token;
}

export const authorizeUrl = (redirectUri: string, state: string) =>
  `https://app.clickup.com/api?${new URLSearchParams({ client_id: process.env.CLICKUP_CLIENT_ID!, redirect_uri: redirectUri, state }).toString()}`;
