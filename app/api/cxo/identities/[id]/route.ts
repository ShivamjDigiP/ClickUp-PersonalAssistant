import { connection } from "next/server";
import { z } from "zod";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { linkIdentity } from "@/lib/integrations/identity";

// The CXO confirms (or clears) which developer a tool account belongs to. All of that account's commits and PRs move with it.
const Body = z.object({ personId: z.string().min(1).nullable() });

async function link(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "personId is required (or null to unlink)" }, { status: 400 });
  const ok = linkIdentity(activeWorkspaceId(), (await params).id, parsed.data.personId);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Account or person not found" }, { status: 404 });
}

export const PUT = withPlatform(link, { write: true });
