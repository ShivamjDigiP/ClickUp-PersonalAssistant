"use client";

import { useEffect, useState } from "react";
import { ACTIVE_KEY } from "./useChat";

// "Signed in as … · Sign out". Only shown when sign-in is turned on for this app.
export function AccountFooter() {
  const [auth, setAuth] = useState<{ enabled: boolean; email: string | null; user: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => setAuth(s.auth ?? null))
      .catch(() => {});
  }, []);

  if (!auth?.enabled) return null;

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    try {
      localStorage.removeItem(ACTIVE_KEY); // the next person on this browser starts clean
    } catch {}
    // full page load on purpose: clears everything held in memory
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
      <span>Signed in as {auth.email || auth.user}</span>
      <button onClick={signOut} disabled={busy} className="underline underline-offset-2 hover:text-[var(--fg)] disabled:opacity-50">
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </p>
  );
}
