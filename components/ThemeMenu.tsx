"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ThemePref } from "./useTheme";

const OPTIONS: { id: ThemePref; label: string; hint: string; icon: string }[] = [
  { id: "auto", label: "Auto", hint: "Follows the app (dark)", icon: "◐" },
  { id: "light", label: "Light", hint: "Always light", icon: "☀" },
  { id: "dark", label: "Dark", hint: "Always dark", icon: "☾" },
];

export function ThemeMenu({
  pref,
  effective,
  onChange,
}: {
  pref: ThemePref;
  effective: "light" | "dark";
  onChange: (p: ThemePref) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change theme"
        title="Theme"
        className="glass grid h-9 w-9 place-items-center rounded-full text-base"
      >
        <motion.span key={effective} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 18 }}>
          {effective === "light" ? "☀" : "☾"}
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="glass absolute right-0 top-11 z-50 w-60 p-1.5"
            style={{ background: "var(--bg)" }}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
          >
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                role="menuitemradio"
                aria-checked={pref === o.id}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-[rgb(var(--tint)/0.07)]"
              >
                <span className="mt-0.5 w-4 text-center">{o.icon}</span>
                <span className="flex-1">
                  <span className="block text-sm">{o.label}</span>
                  <span className="block text-[11px] leading-snug text-[var(--muted)]">{o.hint}</span>
                </span>
                {pref === o.id && <span className="text-[var(--teal)]">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
