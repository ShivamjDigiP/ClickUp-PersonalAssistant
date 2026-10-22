import { checkGemini, checkGroq } from "./ai";
import { checkClickUp } from "./clickup";
import { checkClaudeCli, checkClickUpMcp } from "./claudeCli";
import { checkGitHub } from "./github";
import { checkPush, checkSentry, checkStorage } from "./platform";
import { result, type Connection } from "./types";

export type { Connection, ConnectionState } from "./types";

type Check = { id: string; label: string; run: (local: boolean) => Promise<Connection> | Connection };

const CHECKS: Check[] = [
  { id: "clickup", label: "ClickUp API", run: checkClickUp },
  { id: "gemini", label: "AI · Gemini", run: checkGemini },
  { id: "groq", label: "AI · Groq (backup)", run: checkGroq },
  { id: "github", label: "Git / GitHub", run: checkGitHub },
  { id: "claude", label: "Local Claude", run: checkClaudeCli },
  { id: "mcp", label: "ClickUp MCP", run: checkClickUpMcp },
  { id: "storage", label: "Storage", run: checkStorage },
  { id: "push", label: "Notifications", run: checkPush },
  { id: "sentry", label: "Error tracking", run: checkSentry },
];

// Every check runs at once and one failing never hides the others. Results carry states and short messages only, never secrets.
// `local` = the browser is on the same computer as the app, which unlocks the Claude Code checks.
export async function checkConnections(local: boolean): Promise<Connection[]> {
  const settled = await Promise.allSettled(CHECKS.map(async (c) => c.run(local)));
  return settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : result(CHECKS[i].id, CHECKS[i].label, "down", `Check failed: ${(s.reason as Error).message}`),
  );
}
