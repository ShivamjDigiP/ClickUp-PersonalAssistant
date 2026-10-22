import { runAs } from "../auth/context";
import { reportError } from "../observability";
import { buildDigest, type Digest } from "./digest";
import { localDate, shouldSend } from "./schedule";
import { sendPush, type Payload, type SendResult } from "./send";
import { deleteDigest, listDigests, saveRecord, tokenOf, type DigestRecord } from "./store";

type Deps = {
  send: (sub: DigestRecord["subs"][number], payload: Payload) => Promise<SendResult>;
  build: (rec: DigestRecord, now: Date) => Promise<Digest>;
};

const defaults: Deps = {
  send: sendPush,
  // run AS the person so the ClickUp calls use their own token
  build: (rec, now) => runAs({ userId: rec.userId, token: tokenOf(rec), scheme: rec.scheme, name: rec.name }, () => buildDigest({ name: rec.name, tz: rec.tz, now })),
};

// Sends one person's digest to all their devices. Dead subscriptions are removed; returns how many devices got it.
export async function deliver(rec: DigestRecord, now: Date, deps: Deps = defaults): Promise<{ sent: number; digest?: Digest }> {
  const digest = await deps.build(rec, now);
  const { counts: _counts, ...payload } = digest;
  void _counts;
  const results = await Promise.all(rec.subs.map((s) => deps.send(s, payload)));
  const alive = rec.subs.filter((_, i) => results[i] !== "gone");
  if (!alive.length) await deleteDigest(rec.userId); // every device is gone: stop (and forget the stored token)
  else if (alive.length !== rec.subs.length) await saveRecord({ ...rec, subs: alive });
  return { sent: results.filter((r) => r === "sent").length, digest };
}

export type RunSummary = { checked: number; due: number; sent: number; failed: number };

// Called by the scheduler (about once an hour): sends the digest to everyone whose chosen time has come.
export async function runDigests(now = new Date(), deps: Deps = defaults): Promise<RunSummary> {
  const records = await listDigests();
  const summary: RunSummary = { checked: records.length, due: 0, sent: 0, failed: 0 };

  for (const rec of records) {
    if (!shouldSend(now, rec, rec.lastSent)) continue;
    summary.due++;
    try {
      const { sent } = await deliver(rec, now, deps);
      if (sent > 0) {
        summary.sent++;
        await saveRecord({ ...rec, lastSent: localDate(now.getTime(), rec.tz) }); // never twice in one local day
      } else summary.failed++;
    } catch (e) {
      summary.failed++;
      reportError(e, "digest for one person"); // one person's failure never stops the others
    }
  }
  return summary;
}
