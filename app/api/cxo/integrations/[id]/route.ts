import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { z } from "zod";
import { removeIntegration, updateIntegrationConfig } from "@/lib/integrations/store";

async function remove(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  removeIntegration((await params).id, activeWorkspaceId()); // scoped to the caller's workspace: someone else's id deletes nothing
  return Response.json({ ok: true });
}

// Change a setting of a connected tool: whether merge commits are counted (applies at once) or which repositories are read (applies on the next full sync).
const Patch = z.object({ excludeMergeCommits: z.boolean().optional(), repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).min(1).max(200).optional() }).strict().refine((b) => b.excludeMergeCommits !== undefined || b.repos !== undefined);
async function patch(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nothing valid to change" }, { status: 400 });
  return updateIntegrationConfig((await params).id, activeWorkspaceId(), parsed.data) ? Response.json({ ok: true }) : Response.json({ error: "Integration not found, or the setting does not apply to it" }, { status: 404 });
}

export const PATCH = withPlatform(patch, { write: true });
export const DELETE = withPlatform(remove, { write: true });
