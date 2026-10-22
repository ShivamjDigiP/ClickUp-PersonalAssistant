import { CLICKUP_MCP_URL, runClaude } from "@/lib/connections/claudeCli";
import { isLocalRequest } from "@/lib/connections/local";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 30;

// Adds the official ClickUp MCP server to Claude Code on this computer. Only from http://localhost, with fixed arguments.
// ClickUp still has to be authorized once inside Claude Code (/mcp), which cannot be done from a web page.
async function addClickUpMcp(req: Request) {
  if (!isLocalRequest(req)) return Response.json({ error: "This only works from http://localhost on the computer running the app." }, { status: 403 });
  try {
    await runClaude(["mcp", "add", "--transport", "http", "ClickUp", CLICKUP_MCP_URL], 20_000);
    return Response.json({ ok: true, next: "Added. Now open Claude Code, run /mcp and authorize ClickUp, then Refresh here." });
  } catch (e) {
    return Response.json({ error: `Could not add it: ${(e as Error).message.split("\n")[0]}` }, { status: 500 });
  }
}

export const POST = withAuth(addClickUpMcp);
