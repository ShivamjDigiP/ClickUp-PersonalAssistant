import { connection } from "next/server";
import { currentAuth } from "@/lib/auth/context";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";
import { limit } from "@/lib/ratelimit";
import { safeTz, validHour } from "@/lib/push/schedule";
import { pushConfigured } from "@/lib/push/send";
import { deleteDigest, getDigest, parseSubscription, saveDigest } from "@/lib/push/store";

// Turning the daily digest on or off, and its settings. Everything here belongs to the signed-in person.
async function status() {
  await connection();
  const me = currentAuth()!;
  const rec = await getDigest(me.userId);
  return Response.json({
    configured: pushConfigured(), // false until the server owner has added the VAPID keys
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null, // public by design: the browser needs it to subscribe
    subscribed: !!rec?.subs.length,
    devices: rec?.subs.length ?? 0,
    prefs: rec ? { hour: rec.hour, tz: rec.tz, weekdaysOnly: rec.weekdaysOnly } : null,
  });
}

// Body: { subscription?, prefs: { hour, tz, weekdaysOnly } }. With a subscription it registers this device; without one
// it only changes the settings of an existing digest.
async function save(req: Request) {
  const me = currentAuth()!;
  if (!pushConfigured()) return Response.json({ error: "Notifications aren't set up on this server yet." }, { status: 503 });
  if (!(await limit(`notify/${me.userId}`, 20, 3600)).ok) return Response.json({ error: "Too many changes. Try again later." }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { subscription?: unknown; prefs?: { hour?: unknown; tz?: unknown; weekdaysOnly?: unknown }; label?: string };
  const hour = body.prefs?.hour;
  if (!validHour(hour)) return Response.json({ error: "Choose an hour between 0 and 23." }, { status: 400 });
  const prefs = { hour, tz: safeTz(typeof body.prefs?.tz === "string" ? body.prefs.tz : undefined), weekdaysOnly: body.prefs?.weekdaysOnly !== false };

  const sub = body.subscription ? parseSubscription(body.subscription, body.label) : undefined;
  if (body.subscription && !sub) return Response.json({ error: "That notification subscription isn't valid." }, { status: 400 });
  if (!sub && !(await getDigest(me.userId))) return Response.json({ error: "Turn the digest on first." }, { status: 400 });

  try {
    const rec = await saveDigest({ userId: me.userId, name: me.name ?? "there", token: me.token, scheme: me.scheme, prefs, sub: sub ?? undefined });
    return Response.json({ ok: true, devices: rec.subs.length, prefs });
  } catch (e) {
    reportError(e, "api/notifications save");
    return Response.json({ error: "Could not save your notification settings." }, { status: 500 });
  }
}

// Turn the digest off completely: removes every device AND the stored (encrypted) token used to build it.
async function remove() {
  await deleteDigest(currentAuth()!.userId);
  return Response.json({ ok: true });
}

export const GET = withAuth(status);
export const POST = withAuth(save);
export const DELETE = withAuth(remove);
