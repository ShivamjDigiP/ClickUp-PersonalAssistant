import type { Tool } from "../clickup/tools";
import { ProviderError } from "./errors";
import type { Message } from "./gemini";

// Groq (OpenAI-compatible). History stays in Gemini format; it's converted here per call.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRY_WAIT_MS = 20_000;
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);

export function toOpenAI(system: string, contents: Message[]) {
  const out: any[] = [{ role: "system", content: system }];
  let pending: { id: string; name: string }[] = [];

  contents.forEach((m, mi) => {
    if (m.role === "model") {
      const text = m.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
      const calls = m.parts.filter((p) => p.functionCall);
      pending = calls.map((p, i) => ({ id: `call_${mi}_${i}`, name: p.functionCall.name }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((p, i) => ({
                id: pending[i].id,
                type: "function",
                function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
              })),
            }
          : {}),
      });
      return;
    }
    for (const p of m.parts) {
      if (p.functionResponse) {
        const idx = pending.findIndex((c) => c.name === p.functionResponse.name);
        const id = idx >= 0 ? pending.splice(idx, 1)[0].id : `call_${mi}_x`;
        out.push({ role: "tool", tool_call_id: id, content: JSON.stringify(p.functionResponse.response) });
      }
    }
    const text = m.parts.filter((p) => p.text).map((p) => p.text).join("");
    if (text) out.push({ role: "user", content: text });
  });
  return out;
}

// gpt-oss sends null for optional params and Groq validates strictly, so allow null on non-required ones.
export function nullableOptionals(schema: any) {
  const props = schema?.properties ?? {};
  const req = new Set<string>(schema?.required ?? []);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries<any>(props)) {
    next[k] = req.has(k) || !v?.type || Array.isArray(v.type) ? v : { ...v, type: [v.type, "null"] };
  }
  return { ...schema, properties: next };
}

export const stripNulls = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null));

export async function generateGroq(key: string, model: string, system: string, contents: Message[], tools: Tool[]): Promise<Message> {
  const body = JSON.stringify({
    model,
    messages: toOpenAI(system, contents),
    temperature: 0.2,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: nullableOptionals(t.parameters) },
          })),
          tool_choice: "auto",
        }
      : {}),
  });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) {
      const msg = (await res.json()).choices?.[0]?.message;
      const parts: any[] = [];
      if (msg?.content) parts.push({ text: msg.content });
      for (const c of msg?.tool_calls ?? []) {
        let args = {};
        try {
          args = stripNulls(JSON.parse(c.function.arguments || "{}"));
        } catch {}
        parts.push({ functionCall: { name: c.function.name, args } });
      }
      if (!parts.length) throw new ProviderError("Groq returned no content", 502, 0);
      return { role: "model", parts };
    }

    const text = await res.text();
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? 0) * 1000;
      // Daily token/request caps report long waits: move on instead of blocking the request.
      if (retry && retry <= MAX_RETRY_WAIT_MS && attempt < 2) {
        await sleep(retry);
        continue;
      }
      throw new ProviderError(`Groq ${model} rate limited`, 429, Math.min(retry || 60_000, 3_600_000));
    }
    // Malformed tool call from the model: one retry, then let the next model try.
    if (res.status === 400 && /tool_use_failed|failed_generation/i.test(text) && attempt < 1) continue;
    if (res.status === 503 && attempt < 2) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    throw new ProviderError(`Groq ${model} ${res.status}: ${text.slice(0, 400)}`, res.status, res.status === 404 ? 3_600_000 : 30_000);
  }
}
