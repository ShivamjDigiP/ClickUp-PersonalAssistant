"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

// Press-and-hold to confirm: a ring fills while held; releasing early cancels.
// Works with mouse, touch, and keyboard (hold Space/Enter).
export function HoldButton({
  label,
  onConfirm,
  holdMs = 900,
  disabled,
}: {
  label: string;
  onConfirm: () => void;
  holdMs?: number;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (disabled || holding) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      onConfirm();
    }, reduce ? 250 : holdMs);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && start()}
      onKeyUp={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className="hold-safe relative min-h-11 overflow-hidden rounded-full px-7 py-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
      style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}
    >
      <motion.span
        className="absolute inset-0 origin-left bg-white/60"
        initial={false}
        animate={{ scaleX: holding ? 1 : 0 }}
        transition={{ duration: holding ? (reduce ? 0.25 : holdMs / 1000) : 0.2, ease: "linear" }}
      />
      <span className="relative">{holding ? "Keep holding…" : `${label} · hold`}</span>
    </button>
  );
}
