"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Orb } from "./Orb";
import { ApprovalCard } from "./ApprovalCard";
import { ChartCards } from "./Charts";
import { byAttention, shortName } from "@/lib/health";
import type { useChat } from "./useChat";
import type { Project } from "@/app/api/pulse/route";

type Suggestion = { label: string; prompt?: string; checkIn?: boolean };

// Suggestions are built from the user's real projects, not generic text
function suggestionsFor(projects: Project[] | null): Suggestion[] {
  const ranked = byAttention(projects ?? []);
  const worst = ranked[0];
  const overdue = ranked.reduce((n, p) => n + p.overdue, 0);
  return [
    worst
      ? {
          label: `Show me progress of ${shortName(worst.name, 24)}`,
          prompt: `Show me progress of ${worst.name}`,
        }
      : {
          label: "Show me progress across my projects",
          prompt: "Show me progress across my projects",
        },
    overdue > 0
      ? {
          label: `What is overdue? (${overdue} task${overdue === 1 ? "" : "s"})`,
          prompt: "What is overdue right now?",
        }
      : {
          label: "Summarize blockers from this week",
          prompt: "Summarize blockers from this week",
        },
    {
      label: "Prepare a plan to hit the deadline",
      prompt: "Prepare a plan to hit my nearest deadlines",
    },
    { label: "Ask for my daily check-in", checkIn: true },
  ];
}

const QUICK = [
  { label: "Progress", prompt: "Give me a progress overview of my projects" },
  { label: "Blockers", prompt: "What is blocking my work right now?" },
  { label: "Task updates", prompt: "Which of my tasks were updated recently?" },
  { label: "Suggestions", prompt: "Suggest what I should focus on next" },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const clean = (t: string) => t.replace(/\*\*/g, "").replace(/^\s*\*\s/gm, "• ");

// Words fade in one after another so answers feel like they're being assembled.
function Words({ text, animate }: { text: string; animate?: boolean }) {
  const tokens = clean(text).split(/(\s+)/);
  if (!animate) return <>{tokens.join("")}</>;
  return (
    <>
      {tokens.map((t, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.012, 1.6), duration: 0.25 }}
        >
          {t}
        </motion.span>
      ))}
    </>
  );
}

const ago = (iso: string) => {
  const m = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 8 ? `${d} d ago` : new Date(iso).toLocaleDateString();
};

// Left panel: past conversations. Reopening one restores its full context, so you can carry on where you left off.
function HistoryPanel({
  chat,
  onPicked,
}: {
  chat: ReturnType<typeof useChat>;
  onPicked?: () => void;
}) {
  const { chats, chatId, busy, bubbles, openChat, newChat, removeChat } = chat;
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <button
        onClick={() => {
          newChat();
          onPicked?.();
        }}
        disabled={busy || bubbles.length === 0}
        className="chip w-full justify-center disabled:opacity-40"
      >
        + New chat
      </button>
      <p className="px-1 text-[11px] uppercase tracking-wider text-[var(--muted)]">
        History
      </p>
      <div className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        {chats.length === 0 && (
          <p className="px-2 py-4 text-xs text-[var(--muted)]">
            No saved chats yet. They appear here after your first message.
          </p>
        )}
        {chats.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1 rounded-xl px-3 py-2 text-sm ${c.id === chatId ? "bg-[rgb(var(--tint)/0.12)]" : "hover:bg-[rgb(var(--tint)/0.06)]"}`}
          >
            <button
              disabled={busy}
              onClick={async () => {
                if (await openChat(c.id)) onPicked?.();
              }}
              className="min-w-0 flex-1 text-left disabled:opacity-50"
              aria-current={c.id === chatId ? "true" : undefined}
            >
              <span className="block truncate">{c.title}</span>
              <span className="text-[11px] text-[var(--muted)]">
                {ago(c.updatedAt)} · {c.messages} messages
              </span>
            </button>
            {confirm === c.id ? (
              <button
                onClick={() => {
                  setConfirm(null);
                  removeChat(c.id);
                }}
                onBlur={() => setConfirm(null)}
                autoFocus
                className="rounded-md px-2 py-1 text-[11px] text-[var(--coral)]"
              >
                Delete?
              </button>
            ) : (
              <button
                onClick={() => setConfirm(c.id)}
                aria-label={`Delete chat ${c.title}`}
                className="px-2 text-[var(--muted)] opacity-0 hover:text-[var(--coral)] focus:opacity-100 group-hover:opacity-100"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Soft animated wave behind the input, like the design
function Wave() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 overflow-hidden"
    >
      <svg
        className="wave absolute bottom-0 h-full w-[200%]"
        viewBox="0 0 2400 160"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="wv" x1="0" x2="1">
            <stop offset="0" stopColor="var(--violet)" stopOpacity="0" />
            <stop offset=".5" stopColor="var(--teal)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 110 C 200 40, 400 160, 600 90 S 1000 30, 1200 100 C 1400 40, 1600 160, 1800 90 S 2200 30, 2400 100 L2400 160 L0 160 Z"
          fill="url(#wv)"
        />
      </svg>
    </div>
  );
}

export function ChatView({
  chat,
  name,
  readOnly,
  light,
  projects,
  onCheckIn,
}: {
  chat: ReturnType<typeof useChat>;
  name: string;
  readOnly: boolean;
  light: boolean;
  projects: Project[] | null;
  onCheckIn: () => void;
}) {
  const { bubbles, busy, pulseKey, outcomes, send, decide } = chat;
  const suggestions = suggestionsFor(projects);
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const empty = bubbles.length === 0;
  const [drawer, setDrawer] = useState(false); // history drawer on small screens

  // Smart scrolling: follow new messages only while you're at the bottom, so reading
  // an earlier answer isn't interrupted. A "Latest" button brings you back.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAway(!near);
  };
  const toLatest = () => {
    stick.current = true;
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  useEffect(() => {
    if (stick.current)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bubbles, busy]);

  // ⌘K / Ctrl+K focuses the input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        field.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (text: string) => {
    if (!text.trim()) return;
    setInput("");
    stick.current = true; // sending always jumps to the conversation's end
    send(text);
  };

  return (
    <div className="flex h-full w-full">
      {/* LEFT: chat history */}
      <aside className="hidden w-72 shrink-0 border-r border-[rgb(var(--tint)/0.1)] md:block">
        <HistoryPanel chat={chat} />
      </aside>
      {drawer && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setDrawer(false)}
        >
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-[rgb(var(--tint)/0.1)]"
            style={{ background: "var(--bg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <HistoryPanel chat={chat} onPicked={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {/* RIGHT: chat container */}
      <div className="relative min-w-0 flex-1">
        <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-4">
          <Wave />
          <div className="flex items-center pt-3 md:hidden">
            <button onClick={() => setDrawer(true)} className="chip">
              History{chat.chats.length ? ` · ${chat.chats.length}` : ""}
            </button>
          </div>
          <div
            ref={scroller}
            onScroll={onScroll}
            className="-mx-4 flex-1 overflow-y-auto px-4 py-6"
          >
            {empty ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-6 sm:text-left">
                {/* a little smaller on phones so the greeting fits above the keyboard-sized controls */}
                <div className="-my-5 origin-center scale-[0.72] sm:my-0 sm:scale-100 [@media(max-height:720px)]:hidden">
                  <Orb
                    size={150}
                    thinking={busy}
                    pulseKey={pulseKey}
                    three
                    light={light}
                  />
                </div>
                <div>
                  <h2 className="text-2xl font-light sm:text-3xl">
                    {greeting()}, {name}.
                  </h2>
                  <p className="text-lg font-light text-[var(--muted)] sm:text-2xl">
                    What would you like to work on?
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {bubbles.map((b, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3"
                  >
                    <div
                      className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        b.role === "user"
                          ? "ml-12 bg-gradient-to-br from-indigo-500/90 to-violet-500/80 text-white"
                          : "glass mr-0 sm:mr-12"
                      }`}
                    >
                      {b.role === "assistant" ? (
                        <Words text={b.text} animate={b.fresh} />
                      ) : (
                        b.text
                      )}
                    </div>
                    {b.charts && b.charts.length > 0 && (
                      <ChartCards charts={b.charts} />
                    )}
                    {b.proposals?.map((p) => (
                      <ApprovalCard
                        key={p.id}
                        p={p}
                        outcome={outcomes[p.id]}
                        onDecide={(d) => decide(p, d)}
                      />
                    ))}
                  </motion.div>
                ))}
                {busy && (
                  <div className="flex items-center gap-3 pl-3 text-sm text-[var(--muted)]">
                    <Orb size={28} thinking />
                    Thinking…
                  </div>
                )}
                <div ref={bottom} />
              </div>
            )}
          </div>

          {away && !empty && (
            <button
              onClick={toLatest}
              className="chip absolute bottom-36 left-1/2 z-10 -translate-x-1/2 shadow-lg"
              style={{ background: "var(--bg)" }}
            >
              ↓ Latest
            </button>
          )}

          {/* Phone: one swipeable row of suggestions (saves height). Desktop: a 4-column grid. */}
          {empty && (
            <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-4 sm:pb-4">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => (s.checkIn ? onCheckIn() : submit(s.prompt!))}
                  className="glass min-h-12 px-3 py-2 text-left text-[11px] leading-snug text-[var(--muted)] hover:text-[var(--fg)] sm:py-3 sm:text-xs"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <form
            className="glass flex items-center gap-2 rounded-full p-2 pl-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              ref={field}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your ClickUp work…"
            />
            <kbd className="hidden rounded-md border border-[rgb(var(--tint)/0.15)] px-2 py-1 text-[10px] text-[var(--muted)] sm:block">
              ⌘ K
            </kbd>
            <button
              disabled={busy}
              className="grid h-9 w-9 place-items-center rounded-full bg-[rgb(var(--tint)/0.1)] hover:bg-[rgb(var(--tint)/0.2)] disabled:opacity-40"
              aria-label="Send"
            >
              →
            </button>
          </form>

          {/* wraps instead of scrolling sideways; on phones only the check-in chip stays (the rest duplicate the suggestions) */}
          <div className="flex flex-wrap items-center justify-center gap-2 pb-2 pt-1 sm:pb-4 sm:pt-3">
            <button onClick={onCheckIn} className="chip">
              Daily check-in
            </button>
            {QUICK.map((q) => (
              <button
                key={q.label}
                onClick={() => submit(q.prompt)}
                className="chip hidden sm:inline-flex"
              >
                {q.label}
              </button>
            ))}
          </div>
          <p className="-mt-2 pb-3 text-center text-[11px] text-[var(--muted)]">
            {readOnly
              ? "Read-only mode is on. I can look but not change anything."
              : "Approve & Act mode: I can propose changes, and nothing happens until you approve."}
          </p>
        </div>
      </div>
    </div>
  );
}
