import { connection } from "next/server";
import { clickup } from "@/lib/clickup/client";
import { getSettings, setSettings } from "@/lib/store";

let userName: string | null = null;

async function name() {
  if (userName) return userName;
  try {
    const { user } = await clickup<{ user: any }>("/user");
    userName = String(user.username ?? "").split(" ")[0] || null;
  } catch {
    /* greeting falls back to "there" */
  }
  return userName;
}

export async function GET() {
  await connection();
  return Response.json({ ...(await getSettings()), name: await name() });
}

// Always answers with JSON (also on failure) so the page can show a real message instead of choking on an empty body.
export async function POST(req: Request) {
  try {
    const { readOnly } = (await req.json()) as { readOnly: boolean };
    await setSettings({ readOnly: !!readOnly });
    return Response.json(await getSettings());
  } catch (e) {
    console.error("[settings] could not save:", (e as Error).message);
    return Response.json({ error: `Could not save the setting (${(e as Error).message}).` }, { status: 500 });
  }
}
