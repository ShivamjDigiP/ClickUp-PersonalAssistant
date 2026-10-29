import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { requirePlatform } from "@/lib/platform/context";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { limit } from "@/lib/ratelimit";
import { listIntegrations } from "@/lib/integrations/store";
import { syncIntegration } from "@/lib/integrations/sync";

export const maxDuration = 300; // the first sync reads months of history

// "Sync now": refresh every connected tool. One tool failing never stops the others.
async function syncAll() {
  await connection();
  const me = requirePlatform();
  const ws = activeWorkspaceId();
  const gate = await limit(`cxo-sync:${me.workspaceId}`, 6, 600);
  if (!gate.ok) return Response.json({ error: "Syncing too often. Wait a few minutes and try again." }, { status: 429 });
  const results = [];
  for (const i of listIntegrations(ws)) results.push({ id: i.id, provider: i.provider, label: i.label, ...(await syncIntegration(ws, i.id)) });
  return Response.json({ results });
}

export const POST = withPlatform(syncAll, { write: true });
