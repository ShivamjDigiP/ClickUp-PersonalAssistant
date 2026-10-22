import { connection } from "next/server";
import { checkConnections } from "@/lib/connections";
import { readCached, writeCached } from "@/lib/connections/cache";
import { isLocalRequest } from "@/lib/connections/local";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 30; // `claude mcp list` health-checks every server and can take a while

// Answers from the saved results; only `?refresh=1` (the Refresh button, or after changing a connection) runs the checks again.
async function handler(req: Request) {
  await connection();
  const local = isLocalRequest(req);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const cached = refresh ? null : await readCached(local);
  const items = cached ?? (await checkConnections(local));
  if (!cached) await writeCached(local, items);
  return Response.json(items, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withAuth(handler);
