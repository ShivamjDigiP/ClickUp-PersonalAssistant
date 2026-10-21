import { tools } from "../clickup/tools";

// Runs an approved write action. Re-validates args so only schema-valid input ever reaches ClickUp.
export async function runWriteTool(name: string, args: unknown) {
  const tool = tools.find((t) => t.name === name && t.kind === "write");
  if (!tool) throw new Error(`Unknown write tool ${name}`);
  return tool.run(tool.schema ? tool.schema.parse(args) : args);
}
