"use client";

import { useState } from "react";
import { motion } from "motion/react";
import type { Connection, ConnectionState } from "@/lib/connections/types";

const STATE: Record<ConnectionState, { color: string; label: string }> = {
  ok: { color: "var(--teal)", label: "Connected" },
  warn: { color: "var(--amber)", label: "Needs attention" },
  down: { color: "var(--coral)", label: "Not working" },
  off: { color: "var(--muted)", label: "Not set up" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type Props = { item: Connection; index: number; onChanged: () => void };

export function ConnectionCard({ item, index, onChanged }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const s = STATE[item.state];
  const action = item.action;

  async function call(endpoint: string, init: RequestInit) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setToken("");
      setReplacing(false);
      setMessage(body.next ? { text: body.next, error: false } : null);
      onChanged();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage({ text: `Copied "${command}".`, error: false });
    } catch {
      setMessage({ text: `Copy this: ${command}`, error: false });
    }
  }

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), type: "spring", stiffness: 260, damping: 24 }}
      className="glass flex items-start gap-3 rounded-2xl p-4"
    >
      <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: s.color, boxShadow: item.state === "ok" ? `0 0 14px ${s.color}` : undefined }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">{item.label}</p>
          <span className="shrink-0 text-xs" style={{ color: s.color }}>
            {s.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{item.detail}</p>

        {action?.type === "token" && (item.state !== "ok" || replacing) && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              call(action.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
            }}
          >
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={action.placeholder}
              aria-label={`${item.label} token`}
              className="min-w-0 flex-1 rounded-full border border-[var(--glass-border)] bg-transparent px-3 py-1.5 text-xs outline-none focus:border-[var(--violet)]"
            />
            <button type="submit" className="chip" disabled={busy || !token.trim()}>
              {busy ? "Checking…" : action.label}
            </button>
            <a href={action.helpUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--violet)] underline">
              {action.helpLabel}
            </a>
          </form>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 empty:hidden">
          {action?.type === "token" && item.state === "ok" && !replacing && (
            <button className="chip" onClick={() => setReplacing(true)}>
              Replace key
            </button>
          )}
          {action?.type === "run" && (
            <button className="chip" disabled={busy} onClick={() => call(action.endpoint, { method: "POST" })}>
              {busy ? "Working…" : action.label}
            </button>
          )}
          {item.state !== "ok" &&
            item.more?.map((m) =>
              m.type === "run" ? (
                <button key={m.endpoint} className="chip" disabled={busy} onClick={() => call(m.endpoint, { method: "POST" })}>
                  {busy ? "Working…" : m.label}
                </button>
              ) : null,
            )}
          {action?.type === "copy" && (
            <button className="chip" onClick={() => copy(action.command)}>
              {action.label}
            </button>
          )}
          {item.disconnect && (
            <button className="chip" disabled={busy} onClick={() => call(item.disconnect!, { method: "DELETE" })}>
              Disconnect
            </button>
          )}
        </div>

        {message && (
          <p role={message.error ? "alert" : "status"} className="mt-2 text-xs" style={{ color: message.error ? "var(--coral)" : "var(--teal)" }}>
            {message.text}
          </p>
        )}
        <time className="mt-2 block text-[11px] tabular-nums text-[var(--muted)]">Checked {time(item.checkedAt)}</time>
      </div>
    </motion.li>
  );
}
