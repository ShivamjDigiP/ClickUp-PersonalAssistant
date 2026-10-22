import { tools } from "../clickup/tools";
import { withFailover } from "../clickup/failover";

// Runs an approved write action. Re-validates args so only schema-valid input ever reaches ClickUp.
// `local` lets the ClickUp MCP in Claude Code take over if the direct API refuses.
export async function runWriteTool(name: string, args: unknown, local = false) {
  const tool = tools.find((t) => t.name === name && t.kind === "write");
  if (!tool) throw new Error(`Unknown write tool ${name}`);
  const parsed = tool.schema ? tool.schema.parse(args) : args;
  return withFailover(tool, parsed, local, () => tool.run(parsed));
}
