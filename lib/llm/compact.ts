import type { Message } from "./gemini";

const KEEP_FULL_CHARS = 1200;

// Long chats would otherwise re-send every old tool result on each turn. Results from earlier
// turns are cut down to a preview (the model can simply call the tool again); the current turn stays intact.
export function compactHistory(history: Message[]): Message[] {
  let lastUserText = -1;
  history.forEach((m, i) => {
    if (m.role === "user" && m.parts.some((p) => typeof p.text === "string")) lastUserText = i;
  });
  return history.map((m, i) => {
    if (i >= lastUserText || m.role !== "user") return m;
    return {
      ...m,
      parts: m.parts.map((p) => {
        if (!p.functionResponse) return p;
        const raw = JSON.stringify(p.functionResponse.response ?? {});
        if (raw.length <= KEEP_FULL_CHARS) return p;
        return {
          functionResponse: {
            name: p.functionResponse.name,
            response: { note: "Older tool result trimmed to save space; call the tool again if you need the data.", preview: raw.slice(0, 400) },
          },
        };
      }),
    };
  });
}
