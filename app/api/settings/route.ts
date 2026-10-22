import { connection } from "next/server";
import { clickup } from "@/lib/clickup/client";
import { getSettings, setSettings } from "@/lib/store";
import { authEnabled } from "@/lib/auth/config";
import { authKey, currentAuth } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

const names = new Map<string, string>(); // first name per signed-in person

async function name() {
  const k = authKey();
  const hit = names.get(k);
  if (hit) return hit;
  try {
    const { user } = await clickup<{ user: any }>("/user");
    const first = String(user.username ?? "").split(" ")[0];
    if (first) names.set(k, first);
    return first || null;
  } catch {
    return null; /* greeting falls back to "there" */
  }
}

async function read() {
  await connection();
  const a = currentAuth();
  return Response.json({
    ...(await getSettings()),
    name: await name(),
    auth: { enabled: authEnabled(), email: a?.email ?? null, user: a?.name ?? null }, // lets the UI show "Sign out"
  });
}

// Always answers with JSON (also on failure) so the page can show a real message instead of choking on an empty body.
async function write(req: Request) {
  try {
    const { readOnly } = (await req.json()) as { readOnly: boolean };
    await setSettings({ readOnly: !!readOnly });
    return Response.json(await getSettings());
  } catch (e) {
    reportError(e, "api/settings save");
    return Response.json({ error: `Could not save the setting (${(e as Error).message}).` }, { status: 500 });
  }
}

export const GET = withAuth(read);
export const POST = withAuth(write);
