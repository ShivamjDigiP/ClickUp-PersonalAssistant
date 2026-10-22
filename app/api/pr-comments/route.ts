import { connection } from "next/server";
import { listPrs } from "@/lib/pr-comments/candidates";
import { assertRepo } from "@/lib/git/github";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 60;

const DAYS = [7, 14, 30, 60];

// The person's PRs in the chosen repositories. PRs that name the chosen task come first.
async function handler(req: Request) {
  await connection();
  const params = new URL(req.url).searchParams;
  const repos = (params.get("repos") ?? "").split(",").map((r) => r.trim()).filter(Boolean).slice(0, 10);
  const days = DAYS.includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
  try {
    repos.forEach(assertRepo);
    return Response.json({ prs: await listPrs(repos, days, params.get("task") ?? undefined) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const GET = withAuth(handler);
