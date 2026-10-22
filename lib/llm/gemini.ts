import type { Tool } from "../clickup/tools";
import { ProviderError } from "./errors";

// Gemini provider. Message is also the canonical history format for every provider (see ./index.ts).
export type Message = { role: "user" | "model"; parts: any[] };

const MAX_RETRY_WAIT_MS = 20_000;
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 30_000); // a hung model must not block the whole chain
const MIN_GAP_MS = Number(process.env.GEMINI_MIN_GAP_MS ?? 2000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

function parse429(body: string) {
  let retryMs = 0;
  try {
    const details = JSON.parse(body).error?.details ?? [];
    const info = details.find((d: any) => d["@type"]?.endsWith("RetryInfo"));
    if (info?.retryDelay) retryMs = parseFloat(info.retryDelay) * 1000;
  } catch {}
  // Daily quota, or "limit: 0" (model not on this plan): waiting won't help.
  const hard = /PerDay|limit: 0\b/i.test(body);
  return { hard, retryMs };
}

// Gemini 3 rejects history tool calls that lack a thought signature (e.g. ones produced by another provider).
const withSignatures = (model: string, contents: Message[]): Message[] =>
  /gemini-3/.test(model)
    ? contents.map((m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.functionCall && !p.thoughtSignature ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p,
        ),
      }))
    : contents;

export async function generateGemini(key: string, model: string, system: string, contents: Message[], tools: Tool[]): Promise<Message> {
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: withSignatures(model, contents),
    tools: tools.length
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              ...(Object.keys((t.parameters as any).properties ?? {}).length ? { parameters: t.parameters } : {}),
            })),
          },
        ]
      : undefined,
  });

  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: payload,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      const content = (await res.json()).candidates?.[0]?.content as Message | undefined;
      if (!content?.parts?.length) throw new ProviderError("Gemini returned no content", 502, 0);
      return content;
    }

    const body = await res.text();
    if (res.status === 429) {
      const { hard, retryMs } = parse429(body);
      if (hard) throw new ProviderError(`Daily quota exhausted for ${model}`, 429, 60 * 60_000);
      const delay = Math.max(retryMs, 2000 * 2 ** attempt);
      if (attempt < 2 && delay <= MAX_RETRY_WAIT_MS) {
        await sleep(delay);
        continue;
      }
      throw new ProviderError(`Rate limit on ${model}`, 429, Math.min(delay, 60_000));
    }
    if (res.status === 503 && attempt < 2) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    // 404 = model unavailable to this key: skip it for a long while.
    throw new ProviderError(`Gemini ${model} ${res.status}: ${body.slice(0, 400)}`, res.status, res.status === 404 ? 3_600_000 : 30_000);
  }
}
