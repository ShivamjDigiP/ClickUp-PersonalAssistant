import { connection } from "next/server";
import { proposeComment, type PrRef } from "@/lib/pr-comments/draft";
import { withAuth } from "@/lib/auth/guard";
import { authKey } from "@/lib/auth/context";
import { limit } from "@/lib/ratelimit";
import { isLocalRequest } from "@/lib/connections/local";

export const maxDuration = 60;

async function handler(req: Request) {
  await connection();
  const rate = await limit(`pr-comments/${authKey()}`, 6, 60);
  if (!rate.ok) return Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });

  const { taskId, prs } = (await req.json().catch(() => ({}))) as { taskId?: unknown; prs?: unknown };
  if (typeof taskId !== "string" || !Array.isArray(prs)) return Response.json({ error: "Choose a task and at least one PR." }, { status: 400 });
  const refs: PrRef[] = prs.map((p) => ({ repo: String(p?.repo ?? ""), number: Number(p?.number) }));
  try {
    return Response.json(await proposeComment(taskId, refs, isLocalRequest(req)));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const POST = withAuth(handler);
