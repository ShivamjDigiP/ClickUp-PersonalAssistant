import { resolve } from "@/lib/approval/gate";
import { runWriteTool } from "@/lib/approval/execute";
import { audit, getSettings } from "@/lib/store";
import { withAuth } from "@/lib/auth/guard";

async function handler(req: Request) {
  const { id, decision } = (await req.json()) as { id: string; decision: "approve" | "reject" };
  if (decision !== "approve" && decision !== "reject") {
    return Response.json({ ok: false, error: "Bad decision" }, { status: 400 });
  }
  const { readOnly } = await getSettings(); // checked again at execution time
  const outcome = await resolve(id, decision, { readOnly, run: runWriteTool, audit });
  return Response.json(outcome);
}

export const POST = withAuth(handler);
