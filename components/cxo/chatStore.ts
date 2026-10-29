import type { Chart } from "@/lib/charts";
import type { AnswerMeta } from "@/lib/llm/engine";

// The CXO conversation lives here, outside any component, so it survives moving between pages in this tab.
// Finished conversations are also kept in this browser (per signed-in person) so they can be reopened from the history list.
export type Bubble = { role: "user" | "assistant"; text: string; charts?: Chart[]; meta?: AnswerMeta; error?: boolean };
type State = { id: string | null; bubbles: Bubble[]; history: unknown[] };
export type Session = { id: string; title: string; updatedAt: number; bubbles: Bubble[]; history: unknown[] };
export type SessionInfo = { id: string; title: string; updatedAt: number; messages: number; preview: string };

let state: State = { id: null, bubbles: [], history: [] };
const MAX_SESSIONS = 30;
const key = (owner: string) => `cxo-chats:${owner}`;

function read(owner: string): Session[] {
  try {
    const raw = window.localStorage.getItem(key(owner));
    const list = raw ? (JSON.parse(raw) as Session[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // private window, blocked storage or damaged data: the history list is just empty
  }
}

function write(owner: string, list: Session[]) {
  for (let keep = list.length; keep >= 0; keep--) {
    try {
      window.localStorage.setItem(key(owner), JSON.stringify(list.slice(0, keep)));
      return;
    } catch {
      // storage full: drop the oldest conversation and try again
    }
  }
}

// The first lines of the latest answer, without markdown marks, so a list of conversations says what each one found.
function previewOf(bubbles: Bubble[]): string {
  const answer = [...bubbles].reverse().find((b) => b.role === "assistant" && !b.error)?.text ?? "";
  return answer.replace(/^\s*OPTIONS:.*$/gim, "").replace(/\|[-:\s|]+\|/g, " ").replace(/[|*#`>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

export const chatStore = {
  get: (): State => state,
  set: (next: State) => {
    state = next;
  },
  reset: () => {
    state = { id: null, bubbles: [], history: [] };
  },
  list: (owner: string): SessionInfo[] =>
    read(owner)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt, messages: s.bubbles.length, preview: previewOf(s.bubbles) })),
  load: (owner: string, id: string): Session | null => read(owner).find((s) => s.id === id) ?? null,
  save: (owner: string, saved: Omit<Session, "updatedAt">) => {
    const session: Session = { ...saved, updatedAt: Date.now() };
    write(owner, [session, ...read(owner).filter((s) => s.id !== session.id)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS));
  },
  remove: (owner: string, id: string) => write(owner, read(owner).filter((s) => s.id !== id)),
};
