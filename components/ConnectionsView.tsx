"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectionCard } from "./ConnectionCard";
import type { Connection } from "@/lib/connections/types";

// Kept for the whole browser session: switching tabs and coming back shows the last results instead of checking again.
let remembered: Connection[] | null = null;

export function ConnectionsView() {
  const [items, setItems] = useState<Connection[] | null>(remembered);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(refresh ? "/api/connections?refresh=1" : "/api/connections");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not check connections.");
      remembered = body;
      setItems(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (remembered) return;
    const id = setTimeout(() => load(false), 0);
    return () => clearTimeout(id);
  }, [load]);

  const problems = (items ?? []).filter((c) => c.state === "down" || c.state === "warn").length;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-6 sm:py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-light tracking-tight">Connections</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {items ? (problems ? `${problems} need${problems === 1 ? "s" : ""} attention.` : "Connect what you use. Everything set up is working.") : "Checking what is connected…"}
          </p>
        </div>
        <button className="chip shrink-0" onClick={refresh} disabled={checking} aria-label="Re-check all connections">
          {checking ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-5 text-sm text-[var(--coral)]">
          {error}
        </p>
      )}

      <ul className="mt-5 space-y-3 sm:mt-8" aria-busy={checking}>
        {(items ?? []).map((c, i) => (
          <ConnectionCard key={c.id} item={c} index={i} onChanged={refresh} />
        ))}
      </ul>
    </div>
  );
}
