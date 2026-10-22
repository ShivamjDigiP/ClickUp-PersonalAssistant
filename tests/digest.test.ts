import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KV_BACKEND = "memory";
process.env.AUTH_SECRET = "digest-test-secret-digest-test-secret-12345";
process.env.CLICKUP_API_TOKEN = "pk_test_token_for_the_digest_tests";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { localDate, localParts, safeTz, shouldSend, validHour } from "../lib/push/schedule";
import { buildDigest } from "../lib/push/digest";
import { deleteDigest, getDigest, listDigests, parseSubscription, saveDigest, tokenOf } from "../lib/push/store";
import { deliver, runDigests } from "../lib/push/run";

// Thursday 22 Oct 2026, 09:00 in India (UTC+5:30)
const THU_9AM_IST = new Date("2026-10-22T03:30:00Z");
const prefs = { hour: 9, tz: "Asia/Kolkata", weekdaysOnly: true };

afterEach(() => vi.unstubAllGlobals());

describe("when a digest is due", () => {
  it("understands the person's own clock, not the server's", () => {
    expect(localParts(THU_9AM_IST, "Asia/Kolkata")).toEqual({ date: "2026-10-22", hour: 9, weekday: 4 });
    expect(localParts(THU_9AM_IST, "America/Los_Angeles").hour).toBe(20); // the evening before, in California
    expect(localDate(new Date("2026-10-21T20:00:00Z").getTime(), "Asia/Kolkata")).toBe("2026-10-22"); // already tomorrow in India
  });
  it("sends at the chosen hour and up to 2 hours late, not before or much after", () => {
    expect(shouldSend(new Date("2026-10-22T02:30:00Z"), prefs)).toBe(false); // 8:00 IST: too early
    expect(shouldSend(THU_9AM_IST, prefs)).toBe(true);
    expect(shouldSend(new Date("2026-10-22T05:30:00Z"), prefs)).toBe(true); // 11:00 IST: late but allowed
    expect(shouldSend(new Date("2026-10-22T06:30:00Z"), prefs)).toBe(false); // 12:00 IST: too late, skip today
  });
  it("never sends twice on the same local day", () => {
    expect(shouldSend(THU_9AM_IST, prefs, "2026-10-22")).toBe(false);
    expect(shouldSend(THU_9AM_IST, prefs, "2026-10-21")).toBe(true);
  });
  it("skips weekends only when asked to", () => {
    const sat = new Date("2026-10-24T03:30:00Z");
    expect(shouldSend(sat, prefs)).toBe(false);
    expect(shouldSend(sat, { ...prefs, weekdaysOnly: false })).toBe(true);
  });
  it("falls back to UTC for an unknown time zone instead of crashing", () => {
    expect(safeTz("Mars/Olympus")).toBe("UTC");
    expect(() => shouldSend(THU_9AM_IST, { ...prefs, tz: "Mars/Olympus" })).not.toThrow();
  });
  it("validates the hour", () => {
    expect([0, 9, 23].every(validHour)).toBe(true);
    expect([-1, 24, 9.5, "9", null].some(validHour)).toBe(false);
  });
});

describe("what the digest says", () => {
  const task = (name: string, due?: string) => ({ id: name, name, due_date: due ? String(new Date(due).getTime()) : null });
  function fakeClickUp(tasks: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        const p = new URL(String(url)).pathname;
        const body = p.endsWith("/user") ? { user: { id: 1, username: "Asha Rao" } } : p.endsWith("/team") ? { teams: [{ id: 9 }] } : { tasks };
        return new Response(JSON.stringify(body));
      }),
    );
  }

  it("counts overdue, due today and due this week in the person's time zone", async () => {
    fakeClickUp([
      task("Fix payment bug", "2026-10-21T10:00:00Z"), // yesterday
      task("Review PR", "2026-10-22T10:00:00Z"), // today (15:30 IST)
      task("Write docs", "2026-10-25T10:00:00Z"), // this week
      task("Next month", "2026-11-20T10:00:00Z"),
      task("No date"),
    ]);
    const d = await buildDigest({ name: "Asha Rao", tz: "Asia/Kolkata", now: THU_9AM_IST });
    expect(d.counts).toEqual({ overdue: 1, dueToday: 1, dueSoon: 1, open: 5 });
    expect(d.title).toBe("Good morning, Asha");
    expect(d.body).toContain("1 overdue · 1 due today · 1 due this week");
    expect(d.body).toContain("Most urgent: Fix payment bug");
    expect(d.url).toBe("/?tab=me");
  });
  it("says so when nothing is due, and when there are no tasks", async () => {
    fakeClickUp([task("Later", "2026-12-01T10:00:00Z")]);
    expect((await buildDigest({ name: "A", tz: "UTC", now: THU_9AM_IST })).body).toBe("Nothing is due. 1 open task in progress.");
    fakeClickUp([]);
    expect((await buildDigest({ name: "A", tz: "UTC", now: THU_9AM_IST })).body).toBe("No open tasks. Enjoy the quiet.");
  });
  it("is judged by the person's day: late evening UTC is already tomorrow in India", async () => {
    fakeClickUp([task("Due on the 23rd IST", "2026-10-22T19:00:00Z")]); // 00:30 on the 23rd in India
    const d = await buildDigest({ name: "A", tz: "Asia/Kolkata", now: THU_9AM_IST });
    expect(d.counts.dueToday).toBe(0);
    expect(d.counts.dueSoon).toBe(1);
  });
});

describe("subscriptions and stored tokens", () => {
  const goodSub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } };
  it("only accepts real-looking HTTPS push subscriptions", () => {
    expect(parseSubscription(goodSub)).toMatchObject({ endpoint: goodSub.endpoint });
    for (const bad of [null, {}, { endpoint: "http://insecure.example/x", keys: goodSub.keys }, { endpoint: "https://x.example/y", keys: { p256dh: "p" } }, { endpoint: "not a url", keys: goodSub.keys }]) {
      expect(parseSubscription(bad)).toBeNull();
    }
  });
  it("stores the ClickUp token encrypted, and deleting the digest deletes it", async () => {
    const sub = parseSubscription(goodSub)!;
    const rec = await saveDigest({ userId: "501", name: "Asha", token: "pk_SECRET_TOKEN_VALUE_123456", scheme: "raw", prefs, sub });
    expect(JSON.stringify(rec)).not.toContain("SECRET_TOKEN_VALUE");
    expect(tokenOf(rec)).toBe("pk_SECRET_TOKEN_VALUE_123456");
    await deleteDigest("501");
    expect(await getDigest("501")).toBeNull();
  });
  it("keeps one entry per device and caps the number of devices", async () => {
    for (let i = 0; i < 7; i++) await saveDigest({ userId: "502", name: "A", token: "t".repeat(20), scheme: "raw", prefs, sub: parseSubscription({ ...goodSub, endpoint: `https://push.example/${i}` })! });
    await saveDigest({ userId: "502", name: "A", token: "t".repeat(20), scheme: "raw", prefs, sub: parseSubscription({ ...goodSub, endpoint: "https://push.example/6" })! }); // same device again
    expect((await getDigest("502"))!.subs).toHaveLength(5);
    await deleteDigest("502");
  });
});

describe("the hourly run", () => {
  const sub = (id: string) => parseSubscription({ endpoint: `https://push.example/${id}`, keys: { p256dh: "p", auth: "a" } })!;
  const digest = { title: "Good morning, X", body: "b", url: "/?tab=me", tag: "daily-digest", counts: { overdue: 0, dueToday: 0, dueSoon: 0, open: 0 } };

  beforeEach(async () => {
    for (const r of await listDigests()) await deleteDigest(r.userId);
  });

  it("sends only to people whose time has come, and only once a day", async () => {
    await saveDigest({ userId: "1", name: "Due", token: "t".repeat(20), scheme: "raw", prefs, sub: sub("1") });
    await saveDigest({ userId: "2", name: "Later", token: "t".repeat(20), scheme: "raw", prefs: { ...prefs, hour: 20 }, sub: sub("2") });
    const sent: string[] = [];
    const deps = { build: async () => digest, send: async (s: { endpoint: string }) => (sent.push(s.endpoint), "sent" as const) };

    expect(await runDigests(THU_9AM_IST, deps)).toEqual({ checked: 2, due: 1, sent: 1, failed: 0 });
    expect(sent).toEqual(["https://push.example/1"]);
    expect((await getDigest("1"))!.lastSent).toBe("2026-10-22");

    expect(await runDigests(new Date(THU_9AM_IST.getTime() + 3600_000), deps)).toMatchObject({ due: 0, sent: 0 }); // an hour later: already sent today
  });
  it("one person's failure does not stop the others", async () => {
    await saveDigest({ userId: "3", name: "Broken", token: "t".repeat(20), scheme: "raw", prefs, sub: sub("3") });
    await saveDigest({ userId: "4", name: "Fine", token: "t".repeat(20), scheme: "raw", prefs, sub: sub("4") });
    const deps = {
      build: async (r: { userId: string }) => {
        if (r.userId === "3") throw new Error("ClickUp 500");
        return digest;
      },
      send: async () => "sent" as const,
    };
    expect(await runDigests(THU_9AM_IST, deps)).toMatchObject({ due: 2, sent: 1, failed: 1 });
  });
  it("forgets a person (and their stored token) once every device is gone", async () => {
    await saveDigest({ userId: "5", name: "Gone", token: "t".repeat(20), scheme: "raw", prefs, sub: sub("5") });
    const rec = (await getDigest("5"))!;
    await deliver(rec, THU_9AM_IST, { build: async () => digest, send: async () => "gone" });
    expect(await getDigest("5")).toBeNull();
  });
  it("drops only the dead device and keeps the rest", async () => {
    await saveDigest({ userId: "6", name: "Two", token: "t".repeat(20), scheme: "raw", prefs, sub: sub("6a") });
    await saveDigest({ userId: "6", name: "Two", token: "t".repeat(20), scheme: "raw", prefs, sub: sub("6b") });
    const rec = (await getDigest("6"))!;
    const out = await deliver(rec, THU_9AM_IST, { build: async () => digest, send: async (s) => (s.endpoint.endsWith("6a") ? "gone" : "sent") });
    expect(out.sent).toBe(1);
    expect((await getDigest("6"))!.subs.map((s) => s.endpoint)).toEqual(["https://push.example/6b"]);
  });
});

describe("the scheduler endpoint", () => {
  const call = async (auth?: string) => {
    const { GET } = await import("../app/api/cron/digest/route");
    return GET(new Request("https://app.example/api/cron/digest", { headers: auth ? { authorization: auth } : {} }));
  };
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });
  it("refuses to run without a configured secret", async () => expect((await call()).status).toBe(503));
  it("rejects missing or wrong secrets", async () => {
    process.env.CRON_SECRET = "a-long-enough-shared-secret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-wrong-secret")).status).toBe(401);
    expect((await call("a-long-enough-shared-secret")).status).toBe(401); // must be "Bearer <secret>"
  });
  it("needs the VAPID keys, then runs", async () => {
    process.env.CRON_SECRET = "a-long-enough-shared-secret";
    expect((await call("Bearer a-long-enough-shared-secret")).status).toBe(503);
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    const res = await call("Bearer a-long-enough-shared-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checked: expect.any(Number), sent: 0 });
  });
});
