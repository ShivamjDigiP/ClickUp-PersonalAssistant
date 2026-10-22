import type { Tool } from "../clickup/tools";
import { ProviderError } from "./errors";
import { generateGemini, type Message } from "./gemini";
import { generateGroq } from "./groq";
import { aiKey, AI_KEY_ENV } from "./keys";
import { CLAUDE_MODEL, claudeAvailable, generateClaude } from "./claude";

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

// Read-only view of the chain for the Connections tab: which models belong to which provider and are resting after a limit.
export function chainStatus() {
  const now = Date.now();
  return parseChain().map((e) => ({ id: e.id, provider: e.provider, coolingDown: (cooldown.get(e.id) ?? 0) > now }));
}

const CLAUDE_ID = `claude-local:${CLAUDE_MODEL}`;
const CLAUDE_COOLDOWN_MS = 60_000;

// `local` = the request comes from the computer running the app. Then, when Claude Code is installed, it answers first
// (own login, no quota); Gemini/Groq are the backup if it fails, and the only engine for phones or hosted use.
export async function generate(system: string, contents: Message[], tools: Tool[], opts: { local?: boolean; onEngine?: (e: { id: string; fellBack: boolean }) => void } = {}): Promise<Message> {
  const failures: string[] = [];
  if (opts.local && process.env.LLM_PREFER_CLAUDE !== "0" && (cooldown.get(CLAUDE_ID) ?? 0) <= Date.now() && (await claudeAvailable())) {
    try {
      const reply = await generateClaude(system, contents, tools);
      opts.onEngine?.({ id: CLAUDE_ID, fellBack: false });
      return reply;
    } catch (err) {
      cooldown.set(CLAUDE_ID, Date.now() + CLAUDE_COOLDOWN_MS);
      console.warn(`[llm] ${CLAUDE_ID} failed: ${(err as Error).message}`);
      failures.push(`${CLAUDE_ID}: ${(err as Error).message}`);
    }
  }

  const chain = parseChain();
  const now = Date.now();
  // A key connected on the Connections page wins over .env.local
  const keys = { gemini: await aiKey("gemini"), groq: await aiKey("groq") };
  // Try models that aren't cooling down; if all are, try them all anyway rather than fail blindly.
  let order = chain.filter((e) => (cooldown.get(e.id) ?? 0) <= now);
  if (!order.length) order = chain;

  for (const e of order) {
    try {
      const key = keys[e.provider]?.key;
      if (!key) throw new ProviderError(`${AI_KEY_ENV[e.provider]} is not set`, 0, Infinity);
      const reply = await (e.provider === "gemini" ? generateGemini : generateGroq)(key, e.model, system, contents, tools);
      if (e !== chain[0]) console.info(`[llm] answered by ${e.id}`);
      opts.onEngine?.({ id: e.id, fellBack: failures.length > 0 });
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

  const missingKeys = failures.filter((f) => !f.startsWith(CLAUDE_ID)).every((f) => /_API_KEY is not set/.test(f));
  throw new Error(
    missingKeys
      ? "No LLM API key configured. Set GEMINI_API_KEY and/or GROQ_API_KEY in .env.local."
      : "All configured AI models are at their limits right now. Please try again in a few minutes.",
  );
}
