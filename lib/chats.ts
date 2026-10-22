import { kv } from "./kv";

// Chat sessions, one record each (key "chats/<id>"). Where they live (Redis, files or memory) is decided in ./kv;
// locally that is one JSON file per session under data/chats.
const ID = /^[A-Za-z0-9-]{8,64}$/; // ids become storage keys / file names: never accept anything else
const MAX_SESSIONS = 100;

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bubbles: any[]; // what the UI shows
  history: unknown[]; // what the model sees (Gemini-format messages)
  outcomes: Record<string, unknown>; // approve/reject results per proposal id
};
export type ChatMeta = Pick<ChatSession, "id" | "title" | "createdAt" | "updatedAt"> & { messages: number };

export const validId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
const key = (id: string) => `chats/${id}`;

export async function getChat(id: string): Promise<ChatSession | null> {
  if (!validId(id)) return null;
  try {
    return await kv().get<ChatSession>(key(id));
  } catch {
    return null;
  }
}

async function all(): Promise<ChatSession[]> {
  let ids: string[] = [];
  try {
    ids = (await kv().keys("chats/")).map((k) => k.slice("chats/".length));
  } catch {
    return [];
  }
  const sessions = await Promise.all(ids.map((id) => getChat(id)));
  return sessions.filter((s): s is ChatSession => !!s).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listChats(): Promise<ChatMeta[]> {
  return (await all()).map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messages: s.bubbles.length,
  }));
}

const titleOf = (bubbles: any[]) => {
  const first = bubbles.find((b) => b.role === "user")?.text ?? "New chat";
  const t = String(first).replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
};

export async function saveChat(input: Pick<ChatSession, "id" | "bubbles" | "history" | "outcomes">): Promise<ChatMeta> {
  if (!validId(input.id)) throw new Error("Invalid chat id");
  const prev = await getChat(input.id);
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: input.id,
    title: prev?.title ?? titleOf(input.bubbles),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    bubbles: input.bubbles.map((b) => ({ ...b, fresh: undefined })), // `fresh` is a one-time animation flag
    history: input.history,
    outcomes: input.outcomes ?? {},
  };
  await kv().set(key(input.id), session);

  // Keep storage bounded: drop the oldest sessions beyond the cap.
  const sessions = await all();
  await Promise.all(sessions.slice(MAX_SESSIONS).map((s) => kv().del(key(s.id))));
  return { id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: now, messages: session.bubbles.length };
}

export async function deleteChat(id: string) {
  if (validId(id)) await kv().del(key(id));
}

const snip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// Short digest of recent *other* conversations, so a new chat knows what you worked on lately.
export async function recentDigest(excludeId?: string, count = 3): Promise<string> {
  const recent = (await all()).filter((s) => s.id !== excludeId && s.bubbles.length > 0).slice(0, count);
  return recent
    .map((s) => {
      const lastUser = [...s.bubbles].reverse().find((b) => b.role === "user")?.text ?? "";
      const lastAnswer = [...s.bubbles].reverse().find((b) => b.role === "assistant" && !String(b.text).startsWith("Error:"))?.text ?? "";
      return `- ${s.updatedAt.slice(0, 10)} "${snip(s.title, 60)}". Last question: "${snip(String(lastUser), 120)}". Last answer: "${snip(String(lastAnswer).replace(/\s+/g, " "), 220)}"`;
    })
    .join("\n");
}
