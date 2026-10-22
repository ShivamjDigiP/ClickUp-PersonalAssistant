import { connection } from "next/server";
import { checkHealth } from "@/lib/healthcheck";

// Public on purpose (uptime monitors can't sign in) and it reveals nothing sensitive: just whether the app and its
// storage work, which version is live, and the time. 200 = healthy, 503 = something needs attention.
export const maxDuration = 15;

export async function GET() {
  await connection();
  const h = await checkHealth();
  return Response.json(h, { status: h.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
