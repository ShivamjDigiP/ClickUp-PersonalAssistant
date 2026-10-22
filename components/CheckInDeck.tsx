"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { HoldButton } from "./HoldButton";
import type { Proposal } from "./useChat";

type Card = {
  id: string;
  name: string;
  description: string;
  status: string;
  due: string | null;
  priority: string | null;
  list: string;
  overdue: boolean;
  assignees: string[];
};

const PRIORITY: Record<string, string> = { urgent: "var(--coral)", high: "var(--coral)", normal: "var(--amber)", low: "var(--teal)" };

export function CheckInDeck({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [note, setNote] = useState<null | "blocked" | "note">(null);
  const [text, setText] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [phase, setPhase] = useState<"deck" | "review" | "done">("deck");
  const [results, setResults] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/checkin")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setCards(d.cards)))
      .catch((e) => setError(e.message));
  }, []);

  const card = cards?.[i];
  const advance = (d: number) => {
    setDir(d);
    setNote(null);
    setText("");
    setMsg(null);
    if (cards && i + 1 >= cards.length) setPhase(proposals.length ? "review" : "done");
    else setI((n) => n + 1);
  };

  async function act(action: "done" | "blocked" | "note", noteText?: string) {
    if (!card) return;
    const res = await fetch("/api/checkin/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: card.id, action, note: noteText }),
    }).then((r) => r.json());
    if (res.error) return setMsg(res.error);
    setProposals((p) => [...p, res.proposal]);
    advance(action === "done" ? 1 : -1);
  }

  async function approveAll() {
    const out: string[] = [];
    for (const p of proposals) {
      const r = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, decision: "approve" }),
      }).then((x) => x.json());
      out.push(r.ok ? `✓ ${p.summary}` : `✕ ${p.summary} — ${r.error}`);
    }
    setResults(out);
    setPhase("done");
  }

  const total = cards?.length ?? 0;
  const progress = phase === "deck" ? i / Math.max(total, 1) : 1;

  return (
    <motion.div
      className="fixed fill-screen z-40 grid place-items-center bg-[var(--overlay)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="relative w-full max-w-md">
        <button onClick={onClose} className="absolute -top-10 right-0 text-sm text-[var(--muted)] hover:text-[var(--fg)]" aria-label="Close">
          ✕ Close
        </button>

        <div className="mb-4 flex items-center gap-3 text-xs text-[var(--muted)]">
          <div className="h-1 flex-1 overflow-hidden rounded bg-[rgb(var(--tint)/0.10)]">
            <motion.div className="h-full bg-gradient-to-r from-[var(--teal)] to-[var(--violet)]" animate={{ width: `${progress * 100}%` }} />
          </div>
          {phase === "deck" && total > 0 && <span>{i + 1} of {total}</span>}
        </div>

        {error && <p className="glass p-5 text-sm text-[var(--coral)]">{error}</p>}
        {!cards && !error && <p className="glass p-5 text-sm text-[var(--muted)]">Gathering your open tasks…</p>}

        {cards && total === 0 && phase === "deck" && <p className="glass p-5 text-sm">You have no open tasks. Nothing to check in on 🎉</p>}

        {phase === "deck" && card && (
          <>
            <div className="relative h-64">
              <AnimatePresence custom={dir} mode="popLayout">
                <motion.div
                  key={card.id}
                  custom={dir}
                  className="glass absolute inset-0 p-5"
                  initial={{ y: 40, scale: 0.94, opacity: 0 }}
                  animate={{ y: 0, scale: 1, opacity: 1, x: 0, rotate: 0 }}
                  variants={{
                    swipe: (d: number) => ({ x: d * 320, rotate: d * 12, opacity: 0, transition: { duration: 0.3 } }),
                  }}
                  exit="swipe"
                  transition={{ type: "spring", stiffness: 280, damping: 24 }}
                >
                  <p className="text-xs text-[var(--muted)]">{card.list}</p>
                  <h3 className="mt-2 text-2xl font-semibold leading-snug">{card.name}</h3>
                  {card.description && <p className="mt-2 line-clamp-3 text-sm text-[var(--muted)]">{card.description}</p>}
                  <div className="absolute inset-x-5 bottom-5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-[rgb(var(--tint)/0.10)] px-2 py-1">{card.status}</span>
                    {card.due && (
                      <span className="rounded-full px-2 py-1" style={{ background: card.overdue ? "rgba(255,107,129,.18)" : "rgb(var(--tint)/.1)" }}>
                        {card.overdue ? "Overdue · " : "Due "}
                        {card.due}
                      </span>
                    )}
                    {card.priority && (
                      <span className="rounded-full px-2 py-1" style={{ color: PRIORITY[card.priority] ?? "inherit", background: "rgb(var(--tint)/.08)" }}>
                        {card.priority}
                      </span>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {note ? (
              <form
                className="glass mt-4 flex gap-2 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(note, text);
                }}
              >
                <input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={note === "blocked" ? "What is blocking this?" : "Add a note…"}
                  className="flex-1 bg-transparent px-3 text-sm outline-none"
                />
                <button className="rounded-full bg-[rgb(var(--tint)/0.10)] px-4 py-2 text-sm">Add</button>
              </form>
            ) : (
              <div className="mt-5 grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  { k: "Done", icon: "✓", color: "var(--teal)", run: () => act("done"), write: true },
                  { k: "Still going", icon: "◔", color: "var(--violet)", run: () => advance(1), write: false },
                  { k: "Blocked", icon: "‖", color: "var(--amber)", run: () => setNote("blocked"), write: true },
                  { k: "Add note", icon: "✎", color: "var(--muted)", run: () => setNote("note"), write: true },
                ].map((b) => (
                  <button
                    key={b.k}
                    onClick={b.run}
                    className="group flex flex-col items-center gap-1"
                  >
                    <motion.span
                      whileTap={{ scale: 0.85 }}
                      whileHover={{ scale: 1.08 }}
                      className="grid h-12 w-12 place-items-center rounded-full border text-lg"
                      style={{ borderColor: b.color, color: b.color }}
                    >
                      {b.icon}
                    </motion.span>
                    {b.k}
                  </button>
                ))}
              </div>
            )}
            {msg && <p className="mt-3 text-center text-xs text-[var(--coral)]">{msg}</p>}
          </>
        )}

        {phase === "review" && (
          <div className="glass p-5">
            <h3 className="text-xl font-semibold">Review {proposals.length} change{proposals.length > 1 ? "s" : ""}</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">Nothing has been changed in ClickUp yet.</p>
            <ul className="mt-4 space-y-2 text-sm">
              {proposals.map((p) => (
                <li key={p.id} className="rounded-lg bg-[rgb(var(--tint)/0.05)] p-3">
                  <p className="font-medium">{p.summary}</p>
                  {p.details && <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">{p.details}</p>}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-center">
              <HoldButton label={`Approve ${proposals.length}`} onConfirm={approveAll} />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="glass relative overflow-hidden p-8 text-center">
            <motion.div
              className="mx-auto grid h-20 w-20 place-items-center rounded-full border-2 text-3xl"
              style={{ borderColor: "var(--teal)", color: "var(--teal)" }}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 14 }}
            >
              ✓
            </motion.div>
            <h3 className="mt-4 text-xl font-semibold">Check-in complete</h3>
            {results.length > 0 ? (
              <ul className="mt-3 space-y-1 text-left text-sm">
                {results.map((r, k) => (
                  <li key={k}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">No changes made.</p>
            )}
            {Array.from({ length: 18 }, (_, k) => (
              <motion.span
                key={k}
                className="absolute left-1/2 top-24 h-1.5 w-1.5 rounded-full"
                style={{ background: ["var(--teal)", "var(--amber)", "var(--violet)", "var(--coral)"][k % 4] }}
                initial={{ x: 0, y: 0, opacity: 1 }}
                animate={{ x: Math.cos(k * 0.35) * 170, y: Math.sin(k * 1.3) * 110 - 40, opacity: 0 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            ))}
            <button onClick={onClose} className="mt-6 rounded-full border border-[rgb(var(--tint)/0.15)] px-5 py-2 text-sm">
              Close
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
