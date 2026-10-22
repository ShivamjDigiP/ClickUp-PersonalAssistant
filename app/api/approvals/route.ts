import { resolve } from "@/lib/approval/gate";
import { runWriteTool } from "@/lib/approval/execute";
import { audit } from "@/lib/store";
import { withAuth } from "@/lib/auth/guard";
import { isLocalRequest } from "@/lib/connections/local";

export const maxDuration = 60;

async function handler(req: Request) {
  const { id, decision } = (await req.json()) as { id: string; decision: "approve" | "reject" };
  if (decision !== "approve" && decision !== "reject") {
    return Response.json({ ok: false, error: "Bad decision" }, { status: 400 });
  }
  const local = isLocalRequest(req);
  const outcome = await resolve(id, decision, { run: (tool, args) => runWriteTool(tool, args, local), audit });
  return Response.json(outcome);
}

export const POST = withAuth(handler);
