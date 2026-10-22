import { readSecret } from "../connections/secrets";

export type AiProvider = "gemini" | "groq";

export const AI_KEY_ENV = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" } as const;

// A key connected from the Connections page wins over the one in .env.local, so a person can swap keys without editing files.
export async function aiKey(provider: AiProvider): Promise<{ key: string; source: "web" | "env" } | null> {
  const saved = await readSecret(provider);
  if (saved) return { key: saved, source: "web" };
  const fromEnv = process.env[AI_KEY_ENV[provider]];
  return fromEnv ? { key: fromEnv, source: "env" } : null;
}
