import { connection } from "next/server";
import { lookupPr } from "@/lib/pr-comments/candidates";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 30;

// One PR by pasted link (https://github.com/owner/repo/pull/123), for PRs outside the list.
async function handler(req: Request) {
  await connection();
  const params = new URL(req.url).searchParams;
  const m = (params.get("link") ?? "").trim().match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i);
  if (!m) return Response.json({ error: "Paste a link like https://github.com/owner/repo/pull/123" }, { status: 400 });
  try {
    return Response.json({ pr: await lookupPr(m[1], Number(m[2]), params.get("task") ?? undefined) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const GET = withAuth(handler);
