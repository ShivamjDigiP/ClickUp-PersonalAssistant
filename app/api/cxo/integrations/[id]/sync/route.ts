import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { limit } from "@/lib/ratelimit";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { syncIntegration } from "@/lib/integrations/sync";

export const maxDuration = 300; // the first sync reads months of history

async function sync(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const ws = activeWorkspaceId();
  const { id } = await params;
  const limited = await limit(`cxo-sync:${ws}`, 6, 600); // a sync is heavy: at most 6 per 10 minutes
  if (!limited.ok) return Response.json({ error: "Syncing too often. Wait a few minutes and try again." }, { status: 429 });
  const full = new URL(req.url).searchParams.get("full") === "1";
  const result = await syncIntegration(ws, id, { full });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}

export const POST = withPlatform(sync, { write: true });
