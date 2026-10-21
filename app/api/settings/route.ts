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

export async function POST(req: Request) {
  const { readOnly } = (await req.json()) as { readOnly: boolean };
  await setSettings({ readOnly: !!readOnly });
  return Response.json(await getSettings());
}
