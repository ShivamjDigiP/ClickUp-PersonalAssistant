"use client";

import { motion } from "motion/react";

// Line padlock + "Read-only" + a switch with a big glowing round knob.
// Read-only (knob right, violet, padlock closed): nothing can be changed.
// Approve & Act (knob left, amber, padlock open): the assistant may propose changes, each needs your approval.
function Padlock({ locked }: { locked: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <motion.path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        animate={{ y: locked ? 0 : -2.5, rotate: locked ? 0 : -18 }}
        style={{ originX: "16px", originY: "10.5px" }}
        transition={{ type: "spring", stiffness: 420, damping: 18 }}
      />
    </svg>
  );
}

export function ReadOnlyToggle({ readOnly, onToggle }: { readOnly: boolean; onToggle: () => void }) {
  const glow = readOnly ? "139 123 255" : "255 181 71"; // space-separated so "/ alpha" is valid CSS
  return (
    <button
      role="switch"
      aria-checked={readOnly}
      aria-label={readOnly ? "Read-only mode (on)" : "Approve and act mode (read-only off)"}
      onClick={onToggle}
      title={readOnly ? "Read-only is on: nothing can be changed. Turn off to allow changes (each one still needs your approval)." : "Read-only is off: changes are allowed, each needs your approval. Turn on to block all changes."}
      className="glass flex h-10 items-center gap-2.5 rounded-full pl-3.5 pr-1.5 text-[13px]"
    >
      <span className="text-[var(--muted)]">
        <Padlock locked={readOnly} />
      </span>
      {/* names the active mode; fixed width so the header doesn't shift when it changes */}
      <span className="hidden min-w-[6.2rem] text-left sm:inline">{readOnly ? "Read-only" : "Approve & Act"}</span>
      <span
        className="relative ml-1 h-[26px] w-[46px] rounded-full border border-[rgb(var(--tint)/0.14)]"
        style={{ background: "rgb(var(--tint) / 0.1)" }}
      >
        <motion.span
          className="absolute top-[2px] h-5 w-5 rounded-full"
          style={{
            background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.85), transparent 30%), radial-gradient(circle at 50% 55%, rgb(${glow}), rgb(${glow} / 0.75))`,
          }}
          animate={{ left: readOnly ? 22 : 2, boxShadow: `0 0 14px 2px rgb(${glow} / 0.65)` }}
          transition={{ type: "spring", stiffness: 520, damping: 30 }}
        />
      </span>
    </button>
  );
}
