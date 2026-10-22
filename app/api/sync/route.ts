import { connection } from "next/server";
import { assertRepo } from "@/lib/git/github";
import { reportDigest, runSync } from "@/lib/sync/run";
import { withAuth } from "@/lib/auth/guard";
import { authKey } from "@/lib/auth/context";
import { limit } from "@/lib/ratelimit";
import { isLocalRequest } from "@/lib/connections/local";

export const maxDuration = 60;

const DAYS = [7, 14, 30, 60];

async function handler(req: Request) {
  await connection();
  const rate = await limit(`sync/${authKey()}`, 10, 60);
  if (!rate.ok) return Response.json({ error: "Syncing too often. Wait a minute and try again." }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { repos?: unknown; days?: unknown; ai?: unknown };
  const repos = Array.isArray(body.repos) ? body.repos.map((r) => String(r).trim()).filter(Boolean).slice(0, 10) : [];
  const days = DAYS.includes(Number(body.days)) ? Number(body.days) : 14;
  try {
    repos.forEach(assertRepo);
    const report = await runSync(repos, days, { ai: body.ai !== false, local: isLocalRequest(req) });
    return Response.json({ report, digest: reportDigest(report) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const POST = withAuth(handler);
