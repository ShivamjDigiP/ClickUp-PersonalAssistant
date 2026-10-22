import { chainStatus } from "../llm";
import { aiKey, AI_KEY_ENV, type AiProvider } from "../llm/keys";
import { savedNote, UNREADABLE } from "./saved";
import { secretInfo } from "./secrets";
import { result, withTimeout, type Connection } from "./types";

export type KeyCheck = { ok: true } | { ok: false; error: string };

async function probe(url: string, headers: Record<string, string>, what: string): Promise<KeyCheck> {
  try {
    const res = await withTimeout(fetch(url, { headers, cache: "no-store" }), 8000, what);
    if (res.ok) return { ok: true };
    if ([400, 401, 403].includes(res.status)) return { ok: false, error: `${what} rejected this key. It may be wrong, expired or revoked.` };
    return { ok: false, error: `${what} answered ${res.status}.` };
  } catch (e) {
    return { ok: false, error: `Cannot reach ${what}: ${(e as Error).message}` };
  }
}

// Listing models is free and proves the key works without spending any quota.
export const validateGemini = (key: string) => probe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": key }, "Gemini");
export const validateGroq = (key: string) => probe("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` }, "Groq");

const PROVIDERS: Record<AiProvider, { id: string; label: string; validate: (key: string) => Promise<KeyCheck>; helpUrl: string }> = {
  gemini: { id: "gemini", label: "AI · Gemini", validate: validateGemini, helpUrl: "https://aistudio.google.com/apikey" },
  groq: { id: "groq", label: "AI · Groq (backup)", validate: validateGroq, helpUrl: "https://console.groq.com/keys" },
};

export async function checkAiProvider(provider: AiProvider): Promise<Connection> {
  const { id, label, validate, helpUrl } = PROVIDERS[provider];
  const found = await aiKey(provider);
  const action = { type: "token", endpoint: `/api/connections/${id}`, label: "Save key", placeholder: `Paste a ${provider === "gemini" ? "Gemini" : "Groq"} API key`, helpUrl, helpLabel: "Get a key" } as const;

  if (!found && (await secretInfo(provider))?.unreadable) return result(id, label, "down", UNREADABLE, { action, disconnect: `/api/connections/${id}` });
  if (!found) return result(id, label, "off", `No key. Add one, or set ${AI_KEY_ENV[provider]} in .env.local.`, { action });

  const models = chainStatus().filter((m) => m.provider === provider);
  const ready = models.filter((m) => !m.coolingDown).length;
  const check = await validate(found.key);
  const disconnect = found.source === "web" ? `/api/connections/${id}` : undefined;
  if (!check.ok) return result(id, label, "down", check.error, { action, disconnect });

  const where = found.source === "web" ? `Key saved from this page.${await savedNote(provider)}` : "Key from .env.local";
  if (models.length && ready === 0) return result(id, label, "warn", `${where} works, but all ${models.length} models are cooling down after hitting limits. They retry automatically.`, { action, disconnect });
  const usage = models.length ? ` ${ready} of ${models.length} models ready.` : " Not used by the current model list.";
  return result(id, label, "ok", `${where} works.${usage}`, { action, disconnect });
}

export const checkGemini = () => checkAiProvider("gemini");
export const checkGroq = () => checkAiProvider("groq");
