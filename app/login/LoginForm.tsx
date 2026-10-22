"use client";

import { useState } from "react";
import { motion } from "motion/react";

const ERRORS: Record<string, string> = {
  oauth_unavailable: "Sign in with ClickUp isn't set up on this server yet. You can use a personal API token below.",
  cancelled: "Sign-in was cancelled. You can try again.",
  expired: "That sign-in took too long or was started in another browser. Please try again.",
  state: "The sign-in couldn't be verified. Please try again.",
  rejected: "ClickUp did not accept the sign-in. Please try again.",
  failed: "Something went wrong while signing in. Please try again.",
  not_allowed: "This ClickUp account is not on the list of people allowed to use this app. Ask the owner to add your email.",
};

export function LoginForm({ oauth, error, next }: { oauth: boolean; error: string | null; next: string }) {
  const [showToken, setShowToken] = useState(!oauth); // no OAuth on this server: the token form is the way in
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(error ? (ERRORS[error] ?? ERRORS.failed) : null);

  async function submitToken(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}) as { ok?: boolean; error?: string });
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Sign-in failed (HTTP ${res.status}).`);
      setToken(""); // don't keep it around in the page
      window.location.assign(next);
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center px-5 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <motion.div className="w-full max-w-sm" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="mx-auto h-20 w-20 orb" style={{ animation: "none" }} aria-hidden />
        <h1 className="mt-8 text-center text-3xl font-light tracking-tight">ClickUp Assistant</h1>
        <p className="mt-2 text-center text-sm text-[var(--muted)]">Sign in to see your work in one pulse.</p>

        <div className="glass mt-8 p-5">
          {message && (
            <p role="alert" className="mb-4 rounded-xl border border-[var(--coral)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)] px-3 py-2 text-sm">
              {message}
            </p>
          )}

          {oauth ? (
            <a
              href={`/api/auth/login?next=${encodeURIComponent(next)}`}
              className="block rounded-full px-5 py-3 text-center text-sm font-semibold text-slate-900"
              style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}
            >
              Sign in with ClickUp
            </a>
          ) : (
            <p className="rounded-xl bg-[rgb(var(--tint)/0.06)] px-3 py-2 text-xs text-[var(--muted)]">
              “Sign in with ClickUp” isn&apos;t set up on this server yet. Use your personal API token below.
            </p>
          )}

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-expanded={showToken}
              className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--fg)]"
            >
              {showToken ? "Hide personal token option" : "Use a personal API token instead"}
            </button>
          </div>

          {showToken && (
            <motion.form onSubmit={submitToken} className="mt-4 space-y-3" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
              <label className="block text-xs text-[var(--muted)]" htmlFor="token">
                ClickUp personal API token
              </label>
              <input
                id="token"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="pk_…"
                className="w-full rounded-xl border border-[var(--glass-border)] bg-[rgb(var(--tint)/0.06)] px-4 py-3 text-sm outline-none focus:border-[var(--violet)]"
              />
              <button
                disabled={busy || !token.trim()}
                className="w-full rounded-full border border-[var(--glass-border)] px-5 py-3 text-sm font-medium disabled:opacity-40"
              >
                {busy ? "Checking…" : "Sign in with token"}
              </button>
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                Find it in ClickUp: your avatar → <b>Settings</b> → <b>Apps</b> → <b>API Token</b>. It is checked with ClickUp, stored encrypted, and only used to read and
                (with your approval) change <i>your</i> ClickUp data.
              </p>
            </motion.form>
          )}
        </div>

        {/* Be upfront about where the data goes: the AI is a third-party service */}
        <p className="mt-5 text-center text-[11px] leading-relaxed text-[var(--muted)]">
          You only ever see your own ClickUp data. To answer your questions, the assistant sends them, together with the ClickUp details needed to answer,
          to an AI service (Google Gemini, or Groq as a backup).
        </p>
      </motion.div>
    </main>
  );
}
