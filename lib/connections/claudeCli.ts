import { execFile } from "node:child_process";
import { result, type Connection } from "./types";

// The Claude Code CLI lives on the computer running this app, so these cards only work from http://localhost.
const NOT_LOCAL = "Open this app from http://localhost on the computer where it runs to manage this.";

export const CLICKUP_MCP_URL = "https://mcp.clickup.com/mcp";

export function runClaude(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell: true so Windows finds claude.cmd; the arguments are fixed strings, never user input
    execFile("claude", args, { timeout, shell: true, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

export async function checkClaudeCli(local: boolean): Promise<Connection> {
  if (!local) return result("claude", "Local Claude", "off", NOT_LOCAL);
  try {
    const version = (await runClaude(["--version"], 8000)).trim();
    return result("claude", "Local Claude", "ok", `Claude Code ${version} is installed. It answers your questions first (fastest, no quota); Gemini and Groq are the backup.`);
  } catch {
    return result("claude", "Local Claude", "off", "Claude Code is not installed on this computer. Run this in a terminal, then Refresh.", {
      action: { type: "copy", label: "Copy install command", command: "npm install -g @anthropic-ai/claude-code" },
    });
  }
}

// `claude mcp list` prints one line per server, e.g. "ClickUp: https://example.com/mcp - Connected"
export function parseMcpList(out: string): { name: string; connected: boolean }[] {
  return out
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:]+):\s.*\s-\s+(\S.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[1].trim(), connected: /connected/i.test(m[2]) && !/not connected|fail|disconnected/i.test(m[2]) }));
}

export async function checkClickUpMcp(local: boolean): Promise<Connection> {
  if (!local) return result("mcp", "ClickUp MCP", "off", NOT_LOCAL);
  try {
    const servers = parseMcpList(await runClaude(["mcp", "list"], 20_000));
    const server = servers.find((s) => /clickup/i.test(s.name));
    if (!server) {
      return result("mcp", "ClickUp MCP", "off", "Claude Code has no ClickUp connection yet. Add it, then authorize it once in Claude Code.", {
        action: { type: "run", endpoint: "/api/connections/mcp", label: "Add ClickUp to Claude Code" },
      });
    }
    return server.connected
      ? result("mcp", "ClickUp MCP", "ok", `"${server.name}" is connected in Claude Code. It is the backup if the API token fails.`)
      : result("mcp", "ClickUp MCP", "down", `"${server.name}" needs authorizing. Open Claude Code, run /mcp and choose it.`, {
          action: { type: "copy", label: "Copy /mcp", command: "/mcp" },
        });
  } catch (e) {
    return result("mcp", "ClickUp MCP", "off", `Could not read Claude Code's connections: ${(e as Error).message.split("\n")[0]}`);
  }
}
