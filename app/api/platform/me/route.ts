import { connection } from "next/server";
import { db } from "@/lib/db";
import { platformSession } from "@/lib/platform/guard";

export async function GET(req: Request) {
  await connection();
  const ctx = platformSession(req);
  if (!ctx) return Response.json({ error: "Please sign in.", platformSignIn: true }, { status: 401 });
  const ws = db().prepare("SELECT name FROM workspaces WHERE id = ?").get(ctx.workspaceId) as { name: string } | undefined;
  return Response.json({ name: ctx.name, email: ctx.email, role: ctx.role, workspace: { id: ctx.workspaceId, name: ws?.name ?? "Workspace" } });
}
