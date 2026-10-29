import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { requirePlatform } from "@/lib/platform/context";
import { limit } from "@/lib/ratelimit";
import { auditWorkspace } from "@/lib/integrations/audit";

export const maxDuration = 300; // it re-reads every list in ClickUp and re-counts each repository

// Re-counts the data from the sources and reconciles it with what is stored and shown. Read-only toward the tools.
async function audit() {
  await connection();
  const me = requirePlatform();
  const gate = await limit(`cxo-audit:${me.workspaceId}`, 6, 600);
  if (!gate.ok) return Response.json({ error: "The data check was run very recently. Wait a few minutes." }, { status: 429 });
  return Response.json(await auditWorkspace(me.workspaceId));
}

export const POST = withPlatform(audit);
