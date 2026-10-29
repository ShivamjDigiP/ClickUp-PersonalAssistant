"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ChartCards } from "@/components/Charts";
import { Orb } from "@/components/Orb";
import type { Chart } from "@/lib/charts";
import { describeMeta, type AnswerMeta } from "@/lib/llm/engine";
import { api, useApi } from "./api";
import { chatStore, type Bubble, type SessionInfo } from "./chatStore";
import { Markdown, splitOptions } from "./Markdown";

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 8 ? `${d} d ago` : new Date(ms).toLocaleDateString();
};

type Me = { name: string; email: string };

// Past conversations in a glass window: a title and a little about each, newest first. Picking one brings back everything
// that was said, so you can carry on where you left off.
function HistoryModal({ sessions, openId, busy, now, onOpen, onRemove, onClose }: { sessions: SessionInfo[]; openId: string | null; busy: boolean; now: number; onOpen: (id: string) => void; onRemove: (id: string) => void; onClose: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const shown = sessions.filter((c) => !q.trim() || `${c.title} ${c.preview}`.toLowerCase().includes(q.trim().toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="Chat history">
      <div
        className="flex max-h-[min(36rem,85dvh)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.12)] backdrop-blur-2xl backdrop-saturate-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <h2 className="flex-1 text-[11px] uppercase tracking-widest text-[var(--muted)]">History{sessions.length ? ` · ${sessions.length}` : ""}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[rgb(var(--tint)/0.1)] hover:text-[var(--fg)]">✕</button>
        </div>
        {sessions.length > 3 && (
          <div className="px-5 pb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your chats" aria-label="Search your chats" autoFocus className="w-full rounded-full border border-white/10 bg-[rgb(var(--tint)/0.06)] px-4 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[rgb(var(--tint)/0.35)]" />
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
          {sessions.length === 0 && <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">No saved chats yet. They appear here after your first question.</p>}
          {sessions.length > 0 && shown.length === 0 && <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">No chat matches.</p>}
          {shown.map((c) => (
            <div key={c.id} className={`group flex items-start gap-2 rounded-2xl border px-4 py-3 ${c.id === openId ? "border-[rgb(var(--tint)/0.3)] bg-[rgb(var(--tint)/0.12)]" : "border-transparent hover:border-white/10 hover:bg-[rgb(var(--tint)/0.07)]"}`}>
              <button disabled={busy} onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left disabled:opacity-50" aria-current={c.id === openId ? "true" : undefined}>
                <span className="block truncate text-sm font-medium">{c.title}</span>
                {c.preview && <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-[var(--muted)]">{c.preview}</span>}
                <span className="mt-1 block text-[11px] text-[var(--muted)]">{ago(c.updatedAt, now)} · {c.messages} messages</span>
              </button>
              {confirm === c.id ? (
                <button onClick={() => { setConfirm(null); onRemove(c.id); }} onBlur={() => setConfirm(null)} autoFocus className="rounded-md px-2 py-1 text-[11px] text-[var(--coral)]">Delete?</button>
              ) : (
                <button onClick={() => setConfirm(c.id)} aria-label={`Delete ${c.title}`} className="rounded-md px-2 py-1 text-xs text-[var(--muted)] opacity-0 hover:text-[var(--coral)] focus:opacity-100 group-hover:opacity-100">✕</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatScreen() {
  const me = useApi<Me>("/api/platform/me");
  const owner = me.data?.email ?? "";
  const [sessionId, setSessionId] = useState<string | null>(() => chatStore.get().id);
  const [bubbles, setBubbles] = useState<Bubble[]>(() => chatStore.get().bubbles);
  const [version, setVersion] = useState(0); // bumped whenever the saved list changes
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // the clock is read after the page has loaded, never while it is built: the greeting and "x min ago" need the visitor's time
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const projects = useApi<{ projects: { name: string }[] }>("/api/cxo/projects?days=30");

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is how the list is told to reread storage
  const sessions = useMemo(() => (owner ? chatStore.list(owner) : []), [owner, version]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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

  const project = projects.data?.projects[0]?.name;
  const suggestions = [
    "What is going on with the team this month?",
    "Who has overdue tasks right now?",
    project ? `How much frontend versus backend work happened on ${project}?` : "Which repositories had the most activity?",
    "How much can the team take on over the next two weeks?",
  ];

  function persist(id: string, next: Bubble[], history: unknown[]) {
    if (!owner) return;
    const title = (next.find((b) => b.role === "user")?.text ?? "New chat").replace(/\s+/g, " ").slice(0, 60);
    chatStore.save(owner, { id, title, bubbles: next, history });
    setVersion((v) => v + 1);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const before = chatStore.get();
    const id = before.id ?? crypto.randomUUID();
    setSessionId(id);
    const asked: Bubble[] = [...before.bubbles, { role: "user", text }];
    const history = [...before.history, { role: "user", parts: [{ text }] }];
    chatStore.set({ id, bubbles: asked, history });
    setBubbles(asked);
    try {
      const out = await api<{ text: string; history: unknown[]; charts?: Chart[]; meta?: AnswerMeta }>("/api/cxo/chat", { method: "POST", body: { history } });
      const next: Bubble[] = [...asked, { role: "assistant", text: out.text, charts: out.charts, meta: out.meta }];
      chatStore.set({ id, bubbles: next, history: out.history });
      setBubbles(next);
      persist(id, next, out.history);
    } catch (e) {
      // the failed question is not part of the conversation the model should see
      const next: Bubble[] = [...asked, { role: "assistant", text: (e as Error).message, error: true }];
      chatStore.set({ id, bubbles: next, history: before.history });
      setBubbles(next);
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    chatStore.reset();
    setSessionId(null);
    setBubbles([]);
    setHistoryOpen(false);
  }

  function open(id: string) {
    const s = owner ? chatStore.load(owner, id) : null;
    if (!s) return;
    chatStore.set({ id: s.id, bubbles: s.bubbles, history: s.history });
    setSessionId(s.id);
    setBubbles(s.bubbles);
    setHistoryOpen(false);
  }

  function remove(id: string) {
    if (owner) chatStore.remove(owner, id);
    if (id === sessionId) newChat();
    setVersion((v) => v + 1);
  }

  const empty = bubbles.length === 0;
  const first = (me.data?.name ?? "").split(/\s+/)[0];

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] md:h-dvh">
      <div className="relative min-w-0 flex-1">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4">
          <div className="flex items-center justify-end gap-2 pt-4">
            <button onClick={() => setHistoryOpen(true)} className="chip" aria-haspopup="dialog">History{sessions.length ? ` · ${sessions.length}` : ""}</button>
            <button onClick={newChat} disabled={busy || empty} className="chip disabled:opacity-40">+ New chat</button>
          </div>

          <div className="-mx-4 flex-1 overflow-y-auto px-4 py-6" aria-live="polite">
            {empty ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-6 sm:text-left">
                <div className="-my-5 origin-center scale-[0.72] sm:my-0 sm:scale-100 [@media(max-height:720px)]:hidden">
                  <Orb size={150} thinking={busy} three />
                </div>
                <div>
                  <h2 className="text-2xl font-light sm:text-3xl">{now === null ? "Hello" : greeting(new Date(now).getHours())}{first ? `, ${first}` : ""}.</h2>
                  <p className="text-lg font-light text-[var(--muted)] sm:text-2xl">What would you like to know?</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {bubbles.map((b, i) => {
                  const { body, options } = b.role === "assistant" && !b.error ? splitOptions(b.text) : { body: b.text, options: [] as string[] };
                  return (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${b.role === "user" ? "whitespace-pre-wrap" : ""} ${b.role === "user" ? "ml-12 bg-gradient-to-br from-indigo-500/90 to-violet-500/80 text-white" : b.error ? "border border-[var(--coral)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)]" : "glass sm:mr-12"}`}>
                      {b.role === "assistant" && !b.error ? <Markdown text={body} /> : b.text}
                    </div>
                    {options.length > 0 && i === bubbles.length - 1 && !busy && (
                      <div className="flex flex-wrap gap-2 pl-1" role="group" aria-label="Choose an answer">
                        {options.map((o) => <button key={o} onClick={() => send(o)} className="chip">{o}</button>)}
                      </div>
                    )}
                    {b.charts && b.charts.length > 0 && <ChartCards charts={b.charts} />}
                    {b.meta && <p className="pl-1 text-[11px] text-[var(--muted)]">{describeMeta(b.meta)}</p>}
                  </motion.div>
                  );
                })}
                {busy && <div className="flex items-center gap-3 pl-3 text-sm text-[var(--muted)]"><Orb size={28} thinking />Looking at the data…</div>}
                <div ref={end} />
              </div>
            )}
          </div>

          {empty && (
            <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-4 sm:pb-4">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="glass min-h-12 px-3 py-2 text-left text-[11px] leading-snug text-[var(--muted)] hover:text-[var(--fg)] sm:py-3 sm:text-xs">{s}</button>
              ))}
            </div>
          )}

          <form className="glass flex items-center gap-2 rounded-full p-2 pl-5" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <input ref={field} className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" aria-label="Your question" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your team, a project or a repository…" />
            <kbd className="hidden rounded-md border border-[rgb(var(--tint)/0.15)] px-2 py-1 text-[10px] text-[var(--muted)] sm:block">⌘ K</kbd>
            <button disabled={busy || !input.trim()} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-full bg-[rgb(var(--tint)/0.1)] hover:bg-[rgb(var(--tint)/0.2)] disabled:opacity-40">→</button>
          </form>
          {historyOpen && <HistoryModal sessions={sessions} openId={sessionId} busy={busy} now={now ?? 0} onOpen={open} onRemove={remove} onClose={() => setHistoryOpen(false)} />}
          <p className="mt-3 pb-5 text-center text-[11px] leading-snug text-[var(--muted)]">Answers come from your synced data, with the numbers shown. Nothing here changes your data.</p>
        </div>
      </div>
    </div>
  );
}
