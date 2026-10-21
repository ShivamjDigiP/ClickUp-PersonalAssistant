import type { Tool } from "../clickup/tools";
import { ProviderError } from "./errors";
import { generateGemini, type Message } from "./gemini";
import { generateGroq } from "./groq";

export type { Message } from "./gemini";

// Ordered by capability. Only strong models belong here; weak ones would hurt answer quality.
// Override with LLM_CHAIN="gemini:gemini-2.5-pro,groq:openai/gpt-oss-120b,..."
const DEFAULT_CHAIN = [
  "gemini:gemini-3.8-flash",
  "gemini:gemini-3.7-flash",
  "gemini:gemini-3.5-flash",
  "gemini:gemini-3-flash-preview",
  "gemini:gemini-2.5-flash",
  "groq:openai/gpt-oss-120b",
  "groq:llama-3.3-70b-versatile",
].join(",");

type Entry = { provider: "gemini" | "groq"; model: string; id: string };

export function parseChain(raw = process.env.LLM_CHAIN || DEFAULT_CHAIN): Entry[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      const provider = s.slice(0, i) as Entry["provider"];
      if (provider !== "gemini" && provider !== "groq") throw new Error(`Bad LLM_CHAIN entry "${s}"`);
      return { provider, model: s.slice(i + 1), id: s };
    });
}

const cooldown = new Map<string, number>(); // chain id -> skip until (epoch ms)
export const resetCooldowns = () => cooldown.clear();

export async function generate(system: string, contents: Message[], tools: Tool[]): Promise<Message> {
  const chain = parseChain();
  const now = Date.now();
  // Try models that aren't cooling down; if all are, try them all anyway rather than fail blindly.
  let order = chain.filter((e) => (cooldown.get(e.id) ?? 0) <= now);
  if (!order.length) order = chain;

  const failures: string[] = [];
  for (const e of order) {
    try {
      const reply = await (e.provider === "gemini" ? generateGemini : generateGroq)(e.model, system, contents, tools);
      if (e !== chain[0]) console.info(`[llm] answered by ${e.id}`);
      return reply;
    } catch (err) {
      const timedOut = (err as Error)?.name === "TimeoutError";
      const pe = err instanceof ProviderError
        ? err
        : timedOut
          ? new ProviderError(`${e.id} timed out`, 504, 5 * 60_000) // skip a hanging model for a while
          : new ProviderError((err as Error).message, 500, 30_000);
      if (pe.cooldownMs > 0) cooldown.set(e.id, Date.now() + pe.cooldownMs);
      console.warn(`[llm] ${e.id} failed: ${pe.message}`);
      failures.push(`${e.id}: ${pe.message}`);
    }
  }

  const missingKeys = failures.every((f) => /_API_KEY is not set/.test(f));
  throw new Error(
    missingKeys
      ? "No LLM API key configured. Set GEMINI_API_KEY and/or GROQ_API_KEY in .env.local."
      : "All configured AI models are at their limits right now. Please try again in a few minutes.",
  );
}
