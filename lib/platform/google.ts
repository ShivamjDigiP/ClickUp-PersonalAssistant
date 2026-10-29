import { randomBytes } from "node:crypto";

// Google sign-in (OAuth authorization-code flow). Only active when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
// NOTE: written from Google's documentation and not yet run against a live Google project (no credentials were available).
// Add http(s)://<your host>/api/platform/google/callback as an authorised redirect URI in Google Cloud Console.
export const STATE_COOKIE = "px_oauth";
export const googleEnabled = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
export const redirectUri = (origin: string) => `${origin}/api/platform/google/callback`;
export const newState = () => randomBytes(24).toString("base64url");

export function authorizeUrl(origin: string, state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  return u.toString();
}

export type GoogleProfile = { sub: string; email: string; name: string };

export async function exchangeCode(origin: string, code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(origin), grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error("Google did not accept the sign-in code.");
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error("Google returned no access token.");
  // Ask Google who this is over TLS with the fresh access token, rather than trusting an unverified ID token
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!infoRes.ok) throw new Error("Could not read your Google profile.");
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub || !info.email) throw new Error("Google did not share an e-mail address.");
  if (!info.email_verified) throw new Error("Your Google e-mail address is not verified.");
  return { sub: info.sub, email: info.email, name: info.name ?? info.email };
}
