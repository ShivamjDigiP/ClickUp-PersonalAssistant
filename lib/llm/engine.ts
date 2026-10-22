// How an answer was produced, shown under each chat reply. Safe to import in the browser.
export type AnswerMeta = {
  engines: string[]; // model ids that wrote the answer, in order, e.g. "claude-local:sonnet", "gemini:gemini-3.8-flash"
  fellBack: boolean; // the preferred engine failed first
  clickup?: "api" | "mcp";
  github?: boolean;
  tools: number;
  ms: number;
};

export function engineLabel(id: string): string {
  const i = id.indexOf(":");
  const provider = id.slice(0, i);
  const model = id.slice(i + 1);
  if (provider === "claude-local") return `Claude (local) · ${model}`;
  if (provider === "gemini") return `Gemini · ${model.replace(/^gemini-/, "")}`;
  if (provider === "groq") return `Groq · ${model}`;
  return id;
}

export function describeMeta(m: AnswerMeta): string {
  const parts = [`Answered by ${[...new Set(m.engines)].map(engineLabel).join(" → ") || "no AI"}`];
  if (m.fellBack) parts.push("backup engine used");
  const data = [m.clickup ? `ClickUp ${m.clickup === "mcp" ? "MCP (backup)" : "API"}` : "", m.github ? "GitHub" : ""].filter(Boolean);
  if (data.length) parts.push(`data: ${data.join(" + ")}`);
  if (m.tools) parts.push(`${m.tools} tool${m.tools === 1 ? "" : "s"}`);
  parts.push(`${(m.ms / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}
