import { readSecret, secretInfo } from "./secrets";
import { savedNote, UNREADABLE } from "./saved";
import { result, withTimeout } from "./types";

export const GITHUB_SECRET = "github";

// A token connected from the web page wins over GITHUB_TOKEN in .env.local.
export async function githubToken(): Promise<{ token: string; source: "web" | "env" } | null> {
  const saved = await readSecret(GITHUB_SECRET);
  if (saved) return { token: saved, source: "web" };
  return process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN, source: "env" } : null;
}

export async function githubLogin(token: string): Promise<{ ok: true; login: string } | { ok: false; error: string }> {
  try {
    const res = await withTimeout(
      fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" }),
      8000,
      "GitHub",
    );
    if (res.status === 401) return { ok: false, error: "GitHub rejected this token. It may be wrong, expired or revoked." };
    if (!res.ok) return { ok: false, error: `GitHub answered ${res.status}.` };
    return { ok: true, login: ((await res.json()) as { login: string }).login };
  } catch (e) {
    return { ok: false, error: `Cannot reach GitHub: ${(e as Error).message}` };
  }
}

const CONNECT = {
  type: "token",
  endpoint: "/api/connections/github",
  label: "Connect",
  placeholder: "Paste a GitHub personal access token",
  helpUrl: "https://github.com/settings/tokens?type=beta",
  helpLabel: "Create a token",
} as const;

// Offered only on the computer running the app: it reuses the `gh` login, which usually already has organisation access.
const USE_GH = { type: "run", endpoint: "/api/connections/github/gh", label: "Use my GitHub CLI login" } as const;

export async function checkGitHub(local = false) {
  const more = local ? [USE_GH] : undefined;
  const found = await githubToken();
  if (!found) {
    if ((await secretInfo(GITHUB_SECRET))?.unreadable) return result("github", "Git / GitHub", "down", UNREADABLE, { action: CONNECT, more, disconnect: "/api/connections/github" });
  }
  if (!found) return result("github", "Git / GitHub", "off", "Not connected. Connect a token so the assistant can see your pull requests.", { action: CONNECT, more });

  const who = await githubLogin(found.token);
  const disconnect = found.source === "web" ? "/api/connections/github" : undefined;
  if (!who.ok) return result("github", "Git / GitHub", "down", who.error, { action: CONNECT, more, disconnect });
  const where = found.source === "web" ? await savedNote(GITHUB_SECRET) : " (token from .env.local)";
  return result("github", "Git / GitHub", "ok", `Connected as ${who.login}.${where}`, { action: CONNECT, more, disconnect });
}
