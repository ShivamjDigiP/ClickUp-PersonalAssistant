import { connection } from "next/server";
import { computeMe, type MeStats } from "@/lib/clickup/me";

const cache = new Map<number, { at: number; data: MeStats }>();

// Read-only: your own work stats. Cached for a minute so switching tabs is instant.
export const maxDuration = 60; // many ClickUp calls; allow more than a host's default function limit

export async function GET(req: Request) {
  await connection();
  const n = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(n) ? n : 30;
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < 60_000) return Response.json(hit.data);
  try {
    const data = await computeMe(days);
    cache.set(days, { at: Date.now(), data });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
