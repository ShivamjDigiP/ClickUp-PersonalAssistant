import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { Tool } from "../clickup/tools";
import { runClaude } from "../connections/claudeCli";
import { ProviderError } from "./errors";
import type { Message } from "./gemini";

// Local Claude (Claude Code CLI) as a model provider. It uses the person's own Claude login, so there is no API key and
// no free-tier quota to run out of. The CLI has no function-calling API, so tools are described in the prompt and the
// model answers with one JSON object; it is turned back into the same message shape the other providers return.
// Claude's own tools are switched off (--tools ""), so it can only answer: every action still goes through our tools and
// the approval gate.
const TIMEOUT_MS = Number(process.env.CLAUDE_LOCAL_TIMEOUT_MS ?? 55_000);
export const CLAUDE_MODEL = process.env.CLAUDE_LOCAL_MODEL || "sonnet";

const ENGINE_SYSTEM =
  "You are the reasoning engine of a ClickUp assistant. You cannot run anything yourself. You reply with exactly one JSON object and nothing else.";

const OUTPUT_RULES = `HOW TO REPLY (strict): output exactly one JSON object, no markdown fences, no commentary.
- To use tools: {"calls":[{"name":"<tool name>","args":{...}}]}  (several calls allowed when they are independent)
- To answer the user: {"text":"<your answer, markdown allowed>"}
Only call tools listed below, with arguments matching their parameters. After tool results arrive, call more tools or answer.`;

const describeTools = (tools: Tool[]) =>
  tools.map((t) => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters)}`).join("\n");

function transcript(contents: Message[]): string {
  return contents
    .map((m) => {
      const who = m.role === "user" ? "USER" : "ASSISTANT";
      const body = m.parts
        .map((p) => {
          if (p.functionCall) return `[called ${p.functionCall.name} ${JSON.stringify(p.functionCall.args ?? {})}]`;
          if (p.functionResponse) return `[result of ${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response).slice(0, 12_000)}]`;
          return p.text ?? "";
        })
        .join("\n");
      return `${who}:\n${body}`;
    })
    .join("\n\n");
}

export function buildPrompt(system: string, contents: Message[], tools: Tool[]): string {
  return `${OUTPUT_RULES}\n\n=== YOUR INSTRUCTIONS ===\n${system}\n\n=== TOOLS ===\n${tools.length ? describeTools(tools) : "(none)"}\n\n=== CONVERSATION SO FAR ===\n${transcript(contents)}\n\nNow reply with the JSON object.`;
}

// Turns the model's raw text into a message. Anything that is not the expected JSON is treated as a plain answer.
export function parseReply(raw: string): Message {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1)) as { text?: unknown; calls?: unknown };
      if (Array.isArray(obj.calls) && obj.calls.length) {
        const parts = obj.calls
          .filter((c): c is { name: string; args?: Record<string, unknown> } => typeof c?.name === "string")
          .map((c) => ({ functionCall: { name: c.name, args: c.args ?? {} } }));
        if (parts.length) return { role: "model", parts };
      }
      if (typeof obj.text === "string") return { role: "model", parts: [{ text: obj.text }] };
    } catch {
      /* not JSON after all: fall through and show it as text */
    }
  }
  return { role: "model", parts: [{ text: raw.trim() }] };
}

type HeadlessOptions = { system?: string; extraArgs?: string[]; mcp?: boolean; timeoutMs?: number };

// One headless Claude Code call: prompt in on stdin, the CLI's JSON envelope out. Claude's own tools stay off;
// `mcp: true` also lets it reach the MCP servers set up in Claude Code (limited by --allowedTools in extraArgs).
export function runHeadless(prompt: string, { system = ENGINE_SYSTEM, extraArgs = [], mcp = false, timeoutMs = TIMEOUT_MS }: HeadlessOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell: true so Windows finds claude.cmd. Every argument is a fixed string; the prompt travels on stdin, never in arguments.
    // '""' reaches the CLI as an empty value (the shell would otherwise drop a bare empty argument).
    const child = spawn(
      "claude",
      [
        "-p", "--output-format", "json", "--tools", '""', "--no-session-persistence", "--disable-slash-commands",
        ...(mcp ? [] : ["--strict-mcp-config"]),
        "--setting-sources", '""', "--system-prompt", `"${system}"`, "--model", CLAUDE_MODEL, ...extraArgs,
      ],
      { shell: true, windowsHide: true, cwd: tmpdir() },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error("Claude timed out"), { name: "TimeoutError" }));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (clearTimeout(timer), reject(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new ProviderError(`Claude CLI failed: ${(err || out).trim().slice(0, 200)}`, 500, 60_000));
      resolve(out);
    });
    child.stdin.end(prompt);
  });
}

// The text Claude answered with, from the CLI's JSON envelope.
export function envelopeText(out: string): string {
  let envelope: { result?: string; is_error?: boolean };
  try {
    envelope = JSON.parse(out);
  } catch {
    throw new ProviderError("Claude CLI returned something unreadable", 500, 60_000);
  }
  if (envelope.is_error || typeof envelope.result !== "string") {
    throw new ProviderError(`Claude CLI error: ${String(envelope.result ?? "no result").slice(0, 200)}`, 500, 60_000);
  }
  return envelope.result;
}

export async function generateClaude(system: string, contents: Message[], tools: Tool[]): Promise<Message> {
  return parseReply(envelopeText(await runHeadless(buildPrompt(system, contents, tools))));
}

// Is the CLI installed? Remembered for a few minutes so a chat message never pays for the check.
let availability: { at: number; ok: boolean } | null = null;
export async function claudeAvailable(): Promise<boolean> {
  if (availability && Date.now() - availability.at < 5 * 60_000) return availability.ok;
  const ok = await runClaude(["--version"], 8000).then(() => true, () => false);
  availability = { at: Date.now(), ok };
  return ok;
}
