import { githubLogin, GITHUB_SECRET } from "@/lib/connections/github";
import { ghToken } from "@/lib/connections/ghCli";
import { isLocalRequest } from "@/lib/connections/local";
import { saveSecret } from "@/lib/connections/secrets";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 30;

// Copies the `gh` login of this computer into the person's saved GitHub connection (stored like a pasted token, so it
// stays after restarts and sign-out). Only from http://localhost, since the CLI belongs to the computer running the app.
async function useGh(req: Request) {
  if (!isLocalRequest(req)) return Response.json({ error: "This only works from http://localhost on the computer running the app." }, { status: 403 });
  try {
    const token = await ghToken();
    const who = await githubLogin(token);
    if (!who.ok) return Response.json({ error: who.error }, { status: 400 });
    await saveSecret(GITHUB_SECRET, token);
    return Response.json({ ok: true, next: `Connected as ${who.login} using your GitHub CLI login. It stays connected after restarts and sign-out.` });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const POST = withAuth(useGh);
