"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { HoldButton } from "./HoldButton";
import type { Outcome, Proposal } from "./useChat";

// Details arrive as lines like "Status: In Progress → Done"; render those as before/after rows.
function parse(details?: string) {
  return (details ?? "").split("\n").filter(Boolean).map((line) => {
    const m = line.match(/^(.*?):\s*(.*?)\s→\s(.*)$/);
    return m ? { label: m[1], before: m[2], after: m[3] } : { text: line };
  });
}

export function ApprovalCard({
  p,
  outcome,
  onDecide,
}: {
  p: Proposal;
  outcome?: Outcome;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const rows = useMemo(() => parse(p.details), [p.details]);
  const dots = useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({ x: Math.cos(i) * (60 + (i % 5) * 18), y: Math.sin(i * 1.7) * 60 - 20 })),
    [],
  );
  const pending = !outcome || outcome.state === "working";

  return (
    <AnimatePresence mode="wait" custom={outcome?.state}>
      {pending ? (
        <motion.div
          key="card"
          className="glass relative mr-0 max-w-xl p-5 sm:mr-10"
          style={{ borderColor: "rgba(255,181,71,0.45)" }}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit="gone"
          variants={{
            gone: (s?: string) => ({
              opacity: 0,
              scale: s === "rejected" ? 0.94 : 1.03,
              filter: s === "rejected" ? "blur(10px)" : "blur(0px)",
              transition: { duration: 0.5 },
            }),
          }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <p className="text-xs uppercase tracking-widest text-[var(--amber)]">Proposed change</p>
          <h3 className="mt-1 text-xl font-semibold leading-snug">{p.summary}</h3>

          <div className="mt-4 space-y-2">
            {rows.map((r, i) =>
              "text" in r ? (
                <p key={i} className="whitespace-pre-wrap text-sm text-[var(--muted)]">
                  {r.text}
                </p>
              ) : (
                <div key={i} className="grid grid-cols-[84px_1fr_auto_1fr] items-center gap-2 text-sm">
                  <span className="text-[var(--muted)]">{r.label}</span>
                  <span className="rounded-lg bg-[rgb(var(--tint)/0.05)] px-2 py-1 line-through decoration-[rgb(var(--tint)/0.3)]">{r.before}</span>
                  <span className="text-[var(--amber)]">→</span>
                  <span className="rounded-lg bg-[color-mix(in_srgb,var(--teal)_16%,transparent)] px-2 py-1 text-[var(--teal)]">{r.after}</span>
                </div>
              ),
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <HoldButton label="Approve" disabled={outcome?.state === "working"} onConfirm={() => onDecide("approve")} />
            <button
              onClick={() => onDecide("reject")}
              disabled={outcome?.state === "working"}
              className="rounded-full border border-[rgb(var(--tint)/0.15)] px-5 py-3 text-sm hover:bg-[rgb(var(--tint)/0.05)]"
            >
              Reject
            </button>
          </div>

          {/* particles only visible while the card dissolves on reject */}
          {dots.map((d, i) => (
            <motion.span
              key={i}
              className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-[var(--coral)]"
              initial={{ opacity: 0 }}
              variants={{
                gone: (s?: string) => ({
                  opacity: s === "rejected" ? [0, 1, 0] : 0,
                  x: d.x,
                  y: d.y,
                  transition: { duration: 0.7 },
                }),
              }}
            />
          ))}
        </motion.div>
      ) : (
        <motion.div
          key="stamp"
          className="mr-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm sm:mr-10"
          style={{
            background:
              outcome?.state === "approved" ? "rgba(52,214,176,0.12)" : outcome?.state === "error" ? "rgba(255,107,129,0.12)" : "rgb(var(--tint)/0.06)",
            border: "1px solid rgb(var(--tint)/0.12)",
          }}
          initial={{ opacity: 0, scale: 1.4, rotate: -4 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 16 }}
        >
          {outcome?.state === "approved" && <span className="text-[var(--teal)]">✓ Approved · {p.summary}</span>}
          {outcome?.state === "rejected" && <span className="text-[var(--muted)]">Rejected · no changes made</span>}
          {outcome?.state === "error" && <span className="text-[var(--coral)]">Not done: {outcome.message}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
