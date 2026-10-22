import { authKey } from "../auth/context";
import { runViaMcp } from "./mcp";
import type { Tool } from "./tools";

// The direct ClickUp API (token) is the fast route. When it is failing because of access or connectivity, the ClickUp MCP
// in Claude Code takes over. Mistakes in the request itself (not found, bad input) are never retried elsewhere.
const ACCESS_FAILURE =
  /CLICKUP_API_TOKEN is not set|no token|ClickUp (401|403|5\d\d)\b|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|timed out/i;

// A write is only retried through MCP when the API certainly did not apply it (never reached ClickUp or was refused).
// A timeout or dropped connection is ambiguous, and repeating the write could create a duplicate.
const NOT_APPLIED = /CLICKUP_API_TOKEN is not set|no token|ClickUp (401|403)\b|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i;

export const isAccessFailure = (e: unknown) => ACCESS_FAILURE.test((e as Error)?.message ?? "");

// After the API fails, skip it for a minute and go straight to MCP, instead of waiting on a broken route every call.
const BREAKER_MS = 60_000;
const apiDownUntil = new Map<string, number>();
export const resetFailover = () => apiDownUntil.clear();

type Via = Pick<Tool, "name" | "kind" | "description" | "external">;

// `local` = the request comes from the computer running the app (the only place Claude Code and its MCP exist).
export async function withFailover<T>(tool: Via, args: unknown, local: boolean, viaApi: () => Promise<T>, onVia?: (via: "api" | "mcp") => void): Promise<T | unknown> {
  if (!local || tool.external) return viaApi();
  const who = authKey();
  if ((apiDownUntil.get(who) ?? 0) > Date.now()) {
    try {
      const viaMcp = await runViaMcp(tool, args);
      onVia?.("mcp");
      return viaMcp;
    } catch {
      /* MCP failed too: try the API once more rather than give up */
    }
  }
  try {
    const viaApiResult = await viaApi();
    onVia?.("api");
    return viaApiResult;
  } catch (apiError) {
    if (!(tool.kind === "write" ? NOT_APPLIED : ACCESS_FAILURE).test((apiError as Error).message ?? "")) throw apiError;
    apiDownUntil.set(who, Date.now() + BREAKER_MS);
    try {
      const viaMcp = await runViaMcp(tool, args);
      onVia?.("mcp");
      return viaMcp;
    } catch (mcpError) {
      throw new Error(`${(apiError as Error).message} (ClickUp MCP backup also failed: ${(mcpError as Error).message})`);
    }
  }
}
