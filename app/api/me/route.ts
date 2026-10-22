import { connection } from "next/server";
import { computeMe, type MeStats } from "@/lib/clickup/me";
import { authKey } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

const cache = new Map<string, { at: number; data: MeStats }>(); // keyed by person + period

// Read-only: your own work stats. Cached for a minute so switching tabs is instant.
export const maxDuration = 60; // many ClickUp calls; allow more than a host's default function limit

async function handler(req: Request) {
  await connection();
  const n = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(n) ? n : 30;
  const ck = `${authKey()}:${days}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.data);
  try {
    const data = await computeMe(days);
    cache.set(ck, { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    reportError(e, "api/me");
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = withAuth(handler);
