"use client";

import { motion } from "motion/react";

type Tab = "pulse" | "chat" | "me" | "activity" | "connections";

const Icon = ({ id }: { id: Tab }) => {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (id) {
    case "pulse":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <ellipse cx="12" cy="12" rx="9" ry="4.2" />
          <circle cx="19" cy="9.2" r="1" fill="currentColor" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />
        </svg>
      );
    case "me":
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />
        </svg>
      );
    case "connections":
      return (
        <svg {...common}>
          <path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v4" />
        </svg>
      );
  }
};

// Phone navigation: a bottom tab bar (thumb-reachable), like the mobile mock-up.
export function BottomNav({ tabs, tab, onChange }: { tabs: readonly { id: Tab; label: string }[]; tab: Tab; onChange: (t: Tab) => void }) {
  return (
    // A floating frosted-glass pill that hovers above the bottom edge (and above the iPhone home bar)
    <nav
      aria-label="Sections"
      className="fixed inset-x-4 z-40 mx-auto max-w-md md:hidden"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <ul
        className="flex items-stretch justify-around rounded-[28px] border p-1.5"
        style={{
          background: "linear-gradient(180deg, rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.04))",
          borderColor: "rgb(190 200 255 / 0.22)",
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          boxShadow: "0 12px 40px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.12)",
        }}
      >
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <li key={t.id} className="flex-1">
              <button
                onClick={() => onChange(t.id)}
                aria-current={on ? "page" : undefined}
                className="relative flex w-full flex-col items-center gap-0.5 rounded-[22px] px-2 py-1.5 text-[11px]"
                style={{ color: on ? "var(--fg)" : "var(--muted)", minHeight: 52 }}
              >
                {on && (
                  <motion.span
                    layoutId="bottom-tab"
                    className="absolute inset-0 rounded-[22px]"
                    style={{ background: "rgb(var(--tint) / 0.14)", boxShadow: "inset 0 0 0 1px rgb(190 200 255 / 0.18), 0 0 18px rgb(139 123 255 / 0.25)" }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  />
                )}
                <span className="relative" style={{ color: on ? "var(--violet)" : undefined }}>
                  <Icon id={t.id} />
                </span>
                <span className="relative">{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
