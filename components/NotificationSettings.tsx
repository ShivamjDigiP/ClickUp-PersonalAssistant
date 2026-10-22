"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
  devices: number;
  prefs: { hour: number; tz: string; weekdaysOnly: boolean } | null;
};

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

// The browser wants the public key as bytes, not text
function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Capability = "checking" | "ok" | "dev" | "needs-install" | "unsupported";

function capability(): Capability {
  if (process.env.NODE_ENV !== "production") return "dev"; // the service worker only runs in the deployed build
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iPhones only offer notifications to an app that was added to the Home Screen
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
    return ios && !standalone ? "needs-install" : "unsupported";
  }
  return "ok";
}

export function NotificationSettings() {
  const [cap, setCap] = useState<Capability>("checking");
  const [status, setStatus] = useState<Status | null>(null);
  const [hour, setHour] = useState(9);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const apply = useCallback((s: Status) => {
    setStatus(s);
    if (s.prefs) {
      setHour(s.prefs.hour);
      setWeekdaysOnly(s.prefs.weekdaysOnly);
    }
  }, []);
  const load = useCallback(async () => apply(await fetch("/api/notifications").then((r) => r.json())), [apply]);

  useEffect(() => {
    let off = false;
    const id = setTimeout(() => setCap(capability()), 0); // after hydration, so server and browser agree on first paint
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((s: Status) => !off && apply(s))
      .catch(() => {});
    return () => {
      off = true;
      clearTimeout(id);
    };
  }, [apply]);

  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const say = (text: string, tone: "ok" | "error" = "ok") => setMsg({ text, tone });

  async function post(url: string, init?: RequestInit) {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
    return data;
  }

  async function turnOn() {
    if (!status?.publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const permission = await Notification.requestPermission(); // must come from a tap, which this is
      if (permission !== "granted") throw new Error("Notifications are blocked for this app. Allow them in your phone or browser settings, then try again.");
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status.publicKey) }));
      await post("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ subscription: sub.toJSON(), prefs: { hour, tz: tz(), weekdaysOnly }, label: navigator.userAgent.slice(0, 80) }),
      });
      await load();
      say(`Daily digest is on. You'll get it around ${hourLabel(hour)}${weekdaysOnly ? " on weekdays" : ""}.`);
    } catch (e) {
      say((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(next: { hour?: number; weekdaysOnly?: boolean }) {
    const h = next.hour ?? hour;
    const w = next.weekdaysOnly ?? weekdaysOnly;
    setHour(h);
    setWeekdaysOnly(w);
    if (!status?.subscribed) return; // not on yet: the choice is used when it is turned on
    try {
      await post("/api/notifications", { method: "POST", body: JSON.stringify({ prefs: { hour: h, tz: tz(), weekdaysOnly: w } }) });
      say("Saved.");
    } catch (e) {
      say((e as Error).message, "error");
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post("/api/notifications/test", { method: "POST" });
      say(`Sent. It should arrive in a few seconds (${r.counts?.overdue ?? 0} overdue, ${r.counts?.dueToday ?? 0} due today).`);
    } catch (e) {
      say((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      await post("/api/notifications", { method: "DELETE" });
      await load();
      say("Daily digest is off. Your stored token was deleted.");
    } catch (e) {
      say((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const explain =
    cap === "dev"
      ? "Notifications work in the deployed app (they need the production build)."
      : cap === "needs-install"
        ? "On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), open it from there, then come back here."
        : cap === "unsupported"
          ? "This browser can't show notifications."
          : status && !status.configured
            ? "The server owner hasn't switched notifications on yet."
            : null;

  return (
    <section className="glass p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-widest text-[var(--muted)]">Daily digest</h3>
        {status?.subscribed && <span className="text-[11px] text-[var(--teal)]">On · {status.devices} device{status.devices === 1 ? "" : "s"}</span>}
      </div>

      <p className="text-sm leading-relaxed text-[var(--muted)]">
        A short notification each morning: what&apos;s overdue and what&apos;s due today. Tap it to open the app.
      </p>

      {explain ? (
        <p className="mt-3 rounded-xl bg-[rgb(var(--tint)/0.06)] px-3 py-2 text-xs text-[var(--muted)]">{explain}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-[var(--muted)]">Send at</span>
              <select
                value={hour}
                onChange={(e) => saveSettings({ hour: Number(e.target.value) })}
                className="rounded-full border border-[var(--glass-border)] bg-transparent px-3 py-1.5 text-sm outline-none"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h} className="text-black">
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[var(--muted)]">
              <input type="checkbox" checked={weekdaysOnly} onChange={(e) => saveSettings({ weekdaysOnly: e.target.checked })} className="h-4 w-4 accent-[var(--violet)]" />
              Weekdays only
            </label>
          </div>
          <p className="text-[11px] text-[var(--muted)]">Time zone: {tz()}. It can arrive up to a couple of hours late.</p>

          <div className="flex flex-wrap gap-2">
            {!status?.subscribed ? (
              <button onClick={turnOn} disabled={busy || cap !== "ok" || !status?.configured} className="rounded-full px-5 py-2 text-sm font-medium text-slate-900 disabled:opacity-40" style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}>
                {busy ? "Working…" : "Turn on daily digest"}
              </button>
            ) : (
              <>
                <button onClick={test} disabled={busy} className="chip">
                  {busy ? "Sending…" : "Send me one now"}
                </button>
                <button onClick={turnOff} disabled={busy} className="chip">
                  Turn off
                </button>
              </>
            )}
          </div>

          {!status?.subscribed && (
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              To build your digest while you&apos;re away, the app keeps your ClickUp token <b>encrypted</b> on the server. Turning the digest off deletes it.
            </p>
          )}
        </div>
      )}

      {msg && (
        <p role="status" className="mt-3 text-xs" style={{ color: msg.tone === "error" ? "var(--coral)" : "var(--teal)" }}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
