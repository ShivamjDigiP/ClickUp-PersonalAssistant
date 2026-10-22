import { connection } from "next/server";
import { clickup } from "@/lib/clickup/client";
import { authEnabled } from "@/lib/auth/config";
import { authKey, currentAuth } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";

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
    name: await name(),
    auth: { enabled: authEnabled(), email: a?.email ?? null, user: a?.name ?? null }, // lets the UI show "Sign out"
  });
}

export const GET = withAuth(read);
