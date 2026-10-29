"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { BRAND } from "@/lib/brand";
import { Btn, inputCls } from "@/components/cxo/ui";

const ERRORS: Record<string, string> = {
  oauth_unavailable: "Sign in with ClickUp isn't set up on this server yet. You can use a personal API token below.",
  cancelled: "Sign-in was cancelled. You can try again.",
  expired: "That sign-in took too long or was started in another browser. Please try again.",
  state: "The sign-in couldn't be verified. Please try again.",
  rejected: "ClickUp did not accept the sign-in. Please try again.",
  failed: "Something went wrong while signing in. Please try again.",
  not_allowed: "This account is not allowed to sign in here. Ask the owner for access.",
  google_unavailable: "Google sign-in is not set up on this server.",
};

// One sign-in page for everyone. Which door you use decides where you land:
//  - your Orbit account (e-mail and password, or Google): the team dashboards at /cxo, or the personal assistant for plain team members;
//  - ClickUp (or a ClickUp token): your own personal assistant.
export function LoginForm({ google, oauth, personal, error, next }: { google: boolean; oauth: boolean; personal: boolean; error: string | null; next: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [form, setForm] = useState({ name: "", email: "", password: "", workspaceName: "" });
  const [showToken, setShowToken] = useState(false); // hidden until asked for
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"account" | "token" | null>(null);
  const [message, setMessage] = useState<string | null>(error ? (ERRORS[error] ?? ERRORS.failed) : null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submitAccount(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("account");
    setMessage(null);
    try {
      const res = await fetch(mode === "in" ? "/api/platform/login" : "/api/platform/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "in" ? { email: form.email, password: form.password } : form),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; destination?: string };
      if (!res.ok) throw new Error(data.error ?? `Sign-in failed (HTTP ${res.status}).`);
      // a full page load on purpose: the new session cookie must apply to every request from here on.
      // The server says where this account belongs; a link that was clicked inside the dashboards takes you back there.
      window.location.assign(next.startsWith("/cxo") ? next : (data.destination ?? "/cxo"));
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(null);
    }
  }

  async function submitToken(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token.trim()) return;
    setBusy("token");
    setMessage(null);
    try {
      const res = await fetch("/api/auth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}) as { ok?: boolean; error?: string });
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Sign-in failed (HTTP ${res.status}).`);
      setToken(""); // don't keep it around in the page
      window.location.assign(next.startsWith("/cxo") ? "/" : next);
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center px-5 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <motion.div className="w-full max-w-sm" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="orb mx-auto h-20 w-20" style={{ animation: "none" }} aria-hidden />
        <h1 className="mt-8 text-center text-3xl font-light tracking-tight">{BRAND.name}</h1>
        <p className="mt-2 text-center text-sm text-[var(--muted)]">{mode === "in" ? "Sign in to your workspace." : "Create your workspace. You connect your tools once."}</p>

        <div className="glass mt-8 p-5">
          <div className="mb-4 flex gap-1.5">
            {(["in", "up"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setMessage(null); }} className="chip flex-1 justify-center">
                {m === "in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {message && (
            <p role="alert" className="mb-4 rounded-xl border border-[var(--coral)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)] px-3 py-2 text-sm">
              {message}
            </p>
          )}

          <form onSubmit={submitAccount} className="space-y-3">
            {mode === "up" && (
              <>
                <input className={inputCls} placeholder="Your name" autoComplete="name" required value={form.name} onChange={set("name")} />
                <input className={inputCls} placeholder="Workspace name (e.g. your company)" value={form.workspaceName} onChange={set("workspaceName")} />
              </>
            )}
            <input className={inputCls} type="email" placeholder="Work e-mail" autoComplete="email" required value={form.email} onChange={set("email")} />
            <input className={inputCls} type="password" placeholder={mode === "up" ? "Password (10+ characters)" : "Password"} autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={mode === "up" ? 10 : 1} value={form.password} onChange={set("password")} />
            <button disabled={busy !== null} className={`${Btn.primary} w-full`} style={Btn.primaryStyle}>
              {busy === "account" ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
            </button>
          </form>

          {google && (
            <>
              <p className="my-4 text-center text-[11px] uppercase tracking-widest text-[var(--muted)]">or</p>
              {/* a real page load to Google, not an in-app route */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/platform/google/start" className="block rounded-full border border-[var(--glass-border)] px-5 py-2.5 text-center text-sm hover:bg-[rgb(var(--tint)/0.06)]">
                Continue with Google
              </a>
            </>
          )}
        </div>

        {personal && (
          <div className="mt-4 rounded-2xl border border-[var(--glass-border)] px-5 py-4">
            <p className="text-center text-xs text-[var(--muted)]">Only want your own ClickUp assistant?</p>
            {oauth && (
              <a
                href={`/api/auth/login?next=${encodeURIComponent(next.startsWith("/cxo") ? "/" : next)}`}
                className="mt-3 block rounded-full border border-[var(--glass-border)] px-5 py-2.5 text-center text-sm hover:bg-[rgb(var(--tint)/0.06)]"
              >
                Sign in with ClickUp
              </a>
            )}
            <div className="mt-3 text-center">
              <button type="button" onClick={() => setShowToken((v) => !v)} aria-expanded={showToken} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]">
                {showToken ? "Hide the token option" : "Use a personal ClickUp API token"}
              </button>
            </div>
            {showToken && (
              <motion.form onSubmit={submitToken} className="mt-3 space-y-3" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                <input id="token" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="pk_…" aria-label="ClickUp personal API token" className={inputCls} />
                <button disabled={busy !== null || !token.trim()} className="w-full rounded-full border border-[var(--glass-border)] px-5 py-2.5 text-sm font-medium disabled:opacity-40">
                  {busy === "token" ? "Checking…" : "Sign in with token"}
                </button>
                <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                  In ClickUp: your avatar → <b>Settings</b> → <b>Apps</b> → <b>API Token</b>. It is checked with ClickUp, stored encrypted, and only used for <i>your</i> ClickUp data.
                </p>
              </motion.form>
            )}
          </div>
        )}

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[var(--muted)]">
          Your connected tools stay connected: you set them up once per workspace. Questions you ask the assistant are sent, with the figures needed to answer, to an AI service (Google Gemini, or Groq as a backup).
        </p>
      </motion.div>
    </main>
  );
}
