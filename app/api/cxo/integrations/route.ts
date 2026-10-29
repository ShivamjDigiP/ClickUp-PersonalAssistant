import { connection } from "next/server";
import { z } from "zod";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { listIntegrations, saveIntegration } from "@/lib/integrations/store";
import { ADAPTERS } from "@/lib/integrations/sync";
import { cleanSite } from "@/lib/integrations/jira";

const Body = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("clickup"), label: z.string().trim().min(1).max(60).optional(), secret: z.string().min(8), config: z.object({ teamId: z.string().optional() }).default({}) }),
  z.object({
    provider: z.literal("github"),
    label: z.string().trim().min(1).max(60).optional(),
    secret: z.string().min(8),
    config: z.object({ org: z.string().regex(/^[\w.-]+$/).optional(), repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).min(1).max(200).optional(), maxRepos: z.number().int().min(1).max(60).optional(), excludeMergeCommits: z.boolean().optional() }).default({}),
  }),
  z.object({
    provider: z.literal("jira"),
    label: z.string().trim().min(1).max(60).optional(),
    secret: z.string().min(8),
    config: z.object({ site: z.string().min(3), email: z.string().email(), projects: z.array(z.string().regex(/^[\w-]+$/)).max(30).optional() }),
  }),
]);

async function list() {
  await connection();
  return Response.json({ integrations: listIntegrations(activeWorkspaceId()) });
}

// Connect a tool: the token is checked against the real service first, and only saved if it works.
async function add(req: Request) {
  await connection();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Invalid request: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const { provider, secret } = parsed.data;
  const config: Record<string, unknown> = { ...parsed.data.config };
  if (provider === "jira") config.site = cleanSite(String(config.site));

  const check = await ADAPTERS[provider].validate(config, secret);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const id = saveIntegration({ workspaceId: activeWorkspaceId(), provider, label: parsed.data.label ?? check.account.slice(0, 60), config, secret });
  return Response.json({ id, account: check.account }, { status: 201 });
}

export const GET = withPlatform(list);
export const POST = withPlatform(add, { write: true });
