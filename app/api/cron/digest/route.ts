import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { runDigests } from "@/lib/push/run";
import { pushConfigured } from "@/lib/push/send";
import { reportError } from "@/lib/observability";

// Called by the scheduler about once an hour (see .github/workflows/digest.yml). It sends each person's digest when
// their chosen hour has come. Nobody is signed in here, so it is protected by a shared secret instead:
//   Authorization: Bearer <CRON_SECRET>
// (Vercel Cron sends exactly this header when CRON_SECRET is set, so you can switch to it later.)
export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function GET(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: "CRON_SECRET is not set (use at least 16 random characters)." }, { status: 503 });
  if (!timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  if (!pushConfigured()) return Response.json({ error: "VAPID keys are not set." }, { status: 503 });

  try {
    return Response.json(await runDigests());
  } catch (e) {
    reportError(e, "cron digest");
    return Response.json({ error: "The digest run failed." }, { status: 500 });
  }
}
