"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Chart } from "@/lib/charts";
import type { AnswerMeta } from "@/lib/llm/engine";
import type { SyncReport } from "@/lib/sync/types";

export type Proposal = { id: string; tool: string; summary: string; details?: string };
export type Bubble = {
  role: "user" | "assistant";
  text: string;
  proposals?: Proposal[];
  charts?: Chart[];
  meta?: AnswerMeta; // which engine answered and which data sources it used
  sync?: SyncReport;
  fresh?: boolean;
};
export type Outcome = { state: "working" | "approved" | "rejected" | "error"; message?: string };
export type ChatMeta = { id: string; title: string; createdAt: string; updatedAt: string; messages: number };

// What this browser remembers about "which chat was open": a chat id, "none" (the person deliberately started a fresh
// chat), or nothing (new device, cleared browser or signed out: then we open their latest chat from the server).
export const ACTIVE_KEY = "clickup-assistant:active-chat";
const PROPOSAL_TTL_MS = 14 * 60_000; // server drops unapproved proposals after 15 min or a restart

const newId = () => crypto.randomUUID();
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
};

export function useChat() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatId, setChatId] = useState(newId);
  const history = useRef<unknown[]>([]);
  const dirty = useRef(false); // set when a turn changed the conversation and it needs saving
  const idRef = useRef(chatId);
  idRef.current = chatId;

  const refreshChats = useCallback(async () => {
    try {
      const data = await fetch("/api/chats").then((r) => r.json());
      setChats(data.chats ?? []);
    } catch {}
  }, []);

  const openChat = useCallback(async (id: string) => {
    const data = await fetch(`/api/chats/${id}`).then((r) => r.json()).catch(() => null);
    const chat = data?.chat;
    if (!chat) {
      remember(null);
      return false;
    }
    const stale = Date.now() - new Date(chat.updatedAt).getTime() > PROPOSAL_TTL_MS;
    const restored: Record<string, Outcome> = { ...chat.outcomes };
    if (stale) {
      // Approval cards from an older session can't be approved any more: say so instead of failing on click.
      for (const b of chat.bubbles as Bubble[])
        for (const p of b.proposals ?? [])
          if (!restored[p.id]) restored[p.id] = { state: "error", message: "Expired. Ask again to re-propose it." };
    }
    dirty.current = false;
    history.current = chat.history;
    setOutcomes(restored);
    setBubbles(chat.bubbles);
    setChatId(chat.id);
    remember(chat.id);
    return true;
  }, []);

  const newChat = useCallback(() => {
    dirty.current = false;
    history.current = [];
    setBubbles([]);
    setOutcomes({});
    setChatId(newId());
    remember("none"); // they chose a fresh chat: don't jump back into an old one on the next visit
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      await fetch(`/api/chats/${id}`, { method: "DELETE" }).catch(() => {});
      if (id === idRef.current) newChat();
      refreshChats();
    },
    [newChat, refreshChats],
  );

// On first load: bring back the person's conversations. Chats are saved on the server under their own account, so
  // this works on any device: open the chat this browser remembers if it is theirs, otherwise their latest one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let last: string | null = null;
      try {
        last = localStorage.getItem(ACTIVE_KEY);
      } catch {}
      const data = await fetch("/api/chats").then((r) => r.json()).catch(() => null);
      const list: ChatMeta[] = data?.chats ?? [];
      if (cancelled) return;
      setChats(list);
      if (last === "none") return; // they started a fresh chat last time
      const target = list.find((c) => c.id === last) ?? list[0]; // list is newest first
      if (target) await openChat(target.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [openChat]);

  // Save after each completed turn / approval, never mid-request.
  useEffect(() => {
    if (busy || !dirty.current || bubbles.length === 0) return;
    dirty.current = false;
    fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: idRef.current, bubbles, history: history.current, outcomes }),
    })
      .then(() => {
        remember(idRef.current);
        refreshChats();
      })
      .catch(() => {});
  }, [bubbles, outcomes, busy, refreshChats]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setBusy(true);
      setBubbles((b) => [...b.map((x) => ({ ...x, fresh: false })), { role: "user", text }]);
      history.current.push({ role: "user", parts: [{ text }] });
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history: history.current, sessionId: idRef.current }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        history.current = data.history;
        setBubbles((b) => [...b, { role: "assistant", text: data.text, proposals: data.proposals, charts: data.charts, meta: data.meta, fresh: true }]);
        setPulseKey((k) => k + 1);
      } catch (e) {
        history.current.pop();
        setBubbles((b) => [...b, { role: "assistant", text: `Error: ${(e as Error).message}` }]);
      } finally {
        dirty.current = true;
        setBusy(false);
      }
    },
    [busy],
  );

  // "Sync ClickUp and GitHub": PRs and tasks compared on the server, with AI reading changelogs for PRs that carry no task id; shown as a card with one-click proposals.
  const sync = useCallback(
    async (repos: string[], days: number, ai = true) => {
      if (busy) return;
      setBusy(true);
      const label = `Sync ClickUp and GitHub (${repos.length ? repos.join(", ") : "all my repos"}, last ${days} days)`;
      setBubbles((b) => [...b.map((x) => ({ ...x, fresh: false })), { role: "user", text: label }]);
      try {
        const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repos, days, ai }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error ?? `The sync failed (HTTP ${res.status}).`);
        const r: SyncReport = data.report;
        history.current.push({ role: "user", parts: [{ text: label }] }, { role: "model", parts: [{ text: data.digest }] });
        const text = r.items.length
          ? `Checked ${r.counts.prs} PRs against your ClickUp tasks: ${r.counts.status} need a status update, ${r.counts.prNoTask} PRs have no task, ${r.counts.taskNoPr} tasks have no PR.`
          : `Checked ${r.counts.prs} PRs against your ClickUp tasks. Everything lines up.`;
        const meta: AnswerMeta = { engines: r.ai?.engine ? [r.ai.engine] : [], fellBack: false, clickup: "api", github: true, tools: 0, ms: r.ms };
        setBubbles((b) => [...b, { role: "assistant", text, sync: r, meta, fresh: true }]);
        setPulseKey((k) => k + 1);
      } catch (e) {
        setBubbles((b) => [...b, { role: "assistant", text: `Error: ${(e as Error).message}` }]);
      } finally {
        dirty.current = true;
        setBusy(false);
      }
    },
    [busy],
  );

  const proposeSync = useCallback(async (reportId: string, itemIds: string[]) => {
    setBusy(true);
    try {
      const res = await fetch("/api/sync/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, itemIds }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Could not propose (HTTP ${res.status}).`);
      const proposals: Proposal[] = data.proposals;
      const text = proposals.length ? `I proposed ${proposals.length} change${proposals.length === 1 ? "" : "s"}. Nothing happens until you approve each one.` : "There was nothing to propose for those rows.";
      history.current.push({ role: "user", parts: [{ text: "(System note: sync changes were proposed for approval.)" }] }, { role: "model", parts: [{ text }] });
      setBubbles((b) => [...b.map((x) => ({ ...x, fresh: false })), { role: "assistant", text, proposals, fresh: true }]);
    } catch (e) {
      setBubbles((b) => [...b, { role: "assistant", text: `Error: ${(e as Error).message}` }]);
    } finally {
      dirty.current = true;
      setBusy(false);
    }
  }, []);

  // One short comment on a task, written by AI from the PRs the person ticked; it arrives as an Approve/Reject card.
  const draftComment = useCallback(async (task: { id: string; name: string }, prs: { repo: string; number: number }[]) => {
    setBusy(true);
    const started = Date.now();
    setBubbles((b) => [...b.map((x) => ({ ...x, fresh: false })), { role: "user", text: `Comment on "${task.name}" from ${prs.length} PR${prs.length === 1 ? "" : "s"}` }]);
    try {
      const res = await fetch("/api/pr-comments/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, prs }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? `Could not write the comment (HTTP ${res.status}).`);
      const skipped: string[] = data.skipped ?? [];
      const text = `I drafted a short comment for the task. Nothing is posted until you approve it.${skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""}`;
      const meta: AnswerMeta = { engines: data.engine ? [data.engine] : [], fellBack: false, clickup: "api", github: true, tools: 0, ms: Date.now() - started };
      history.current.push({ role: "user", parts: [{ text: `(System note: a comment on task "${task.name}" was drafted from PRs for approval.)` }] }, { role: "model", parts: [{ text }] });
      setBubbles((b) => [...b, { role: "assistant", text, proposals: [data.proposal], meta, fresh: true }]);
    } catch (e) {
      setBubbles((b) => [...b, { role: "assistant", text: `Error: ${(e as Error).message}` }]);
    } finally {
      dirty.current = true;
      setBusy(false);
    }
  }, []);

  const decide = useCallback(async (p: Proposal, decision: "approve" | "reject") => {
    setOutcomes((o) => ({ ...o, [p.id]: { state: "working" } }));
    // Never leave the card stuck on "working": a timeout, an HTML error page or a dropped connection becomes a visible message.
    const out: { ok?: boolean; error?: string } = await (async () => {
      try {
        const res = await fetch("/api/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: p.id, decision }),
          signal: AbortSignal.timeout(55_000),
        });
        const data = await res.json().catch(() => null);
        if (data && typeof data === "object") return data;
        return { ok: false, error: `The server didn't answer properly (HTTP ${res.status}). Check ClickUp before retrying, then ask again.` };
      } catch {
        return { ok: false, error: "Couldn't reach the server. Check your connection and ask again. Nothing was confirmed as changed." };
      }
    })();
    const state: Outcome["state"] = out.ok ? "approved" : decision === "reject" ? "rejected" : "error";
    dirty.current = true;
    setOutcomes((o) => ({ ...o, [p.id]: { state, message: out.ok ? undefined : out.error } }));
    // keep the model's picture of the world accurate
    history.current.push({
      role: "user",
      parts: [{ text: `(System note: "${p.summary}" was ${out.ok ? "approved and executed" : `not executed: ${out.error}`}.)` }],
    });
    if (out.ok) setPulseKey((k) => k + 1);
  }, []);

  return { bubbles, busy, pulseKey, outcomes, send, sync, proposeSync, draftComment, decide, chats, chatId, openChat, newChat, removeChat, refreshChats };
}
