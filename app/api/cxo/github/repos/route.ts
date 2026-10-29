import { connection } from "next/server";
import { z } from "zod";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { getIntegration } from "@/lib/integrations/store";
import { listAccessibleRepos } from "@/lib/integrations/github";
import type { GitHubConfig } from "@/lib/integrations/types";

// The repositories a GitHub token can read, so the person connecting chooses which ones count.
// Either a token typed in the connect form (nothing is stored yet) or an already connected integration of this workspace.
const Body = z.union([
  z.object({ secret: z.string().min(8), org: z.string().regex(/^[\w.-]+$/).optional() }),
  z.object({ integrationId: z.string().min(1) }),
]);
const ACTIVE_DAYS = 90;

async function find(req: Request) {
  await connection();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send a GitHub token, or the id of a connected GitHub integration." }, { status: 400 });
  let secret: string;
  let org: string | undefined;
  let chosen: string[] | undefined;
  if ("integrationId" in parsed.data) {
    const integ = getIntegration(parsed.data.integrationId, activeWorkspaceId()); // scoped to the caller's workspace
    if (!integ || integ.provider !== "github") return Response.json({ error: "GitHub integration not found." }, { status: 404 });
    const cfg = integ.config as GitHubConfig;
    secret = integ.secret;
    org = cfg.org;
    chosen = cfg.repos;
  } else {
    ({ secret, org } = parsed.data);
  }
  try {
    const repos = await listAccessibleRepos(secret, org);
    const cutoff = Date.now() - ACTIVE_DAYS * 86_400_000;
    const active = (r: (typeof repos)[number]) => !r.archived && !r.fork && (r.pushedAt ?? 0) >= cutoff;
    // what is ticked to begin with: the saved choice, else every repository with recent activity
    const selected = chosen?.length ? chosen.filter((n) => repos.some((r) => r.name === n)) : repos.filter(active).map((r) => r.name);
    return Response.json({ repos, selected });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const POST = withPlatform(find, { write: true });
