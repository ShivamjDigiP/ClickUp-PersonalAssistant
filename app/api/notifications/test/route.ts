import { currentAuth } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";
import { limit } from "@/lib/ratelimit";
import { deliver } from "@/lib/push/run";
import { getDigest } from "@/lib/push/store";

export const maxDuration = 30;

// "Send me one now": builds today's real digest and pushes it to this person's devices.
async function handler() {
  const me = currentAuth()!;
  if (!(await limit(`notify-test/${me.userId}`, 5, 3600)).ok) {
    return Response.json({ error: "That's enough tests for now. Try again in an hour." }, { status: 429 });
  }
  const rec = await getDigest(me.userId);
  if (!rec?.subs.length) return Response.json({ error: "Turn the digest on first." }, { status: 400 });

  try {
    const { sent, digest } = await deliver(rec, new Date());
    if (!sent) return Response.json({ error: "The notification could not be delivered. Turn the digest off and on again." }, { status: 502 });
    return Response.json({ ok: true, sent, counts: digest?.counts });
  } catch (e) {
    reportError(e, "api/notifications/test");
    return Response.json({ error: "Could not build your digest right now." }, { status: 500 });
  }
}

export const POST = withAuth(handler);
