import { propose, type Pending } from "../approval/gate";
import { tools } from "../clickup/tools";
import { kv } from "../kv";
import { audit } from "../store";
import { reportKey } from "./run";
import type { SyncPr, SyncReport } from "./types";

const MAX_PROPOSALS = 15;

const linkComment = (pr: SyncPr) => `Linked PR ${pr.repo}#${pr.number}: ${pr.title}\n${pr.url}`;

// Turns chosen rows of a saved sync report into the usual Approve/Reject proposals. The server rebuilds every action from
// its own saved report, so the browser can only pick rows, never supply what gets changed.
export async function proposeFromReport(reportId: string, itemIds: string[]): Promise<Pending[]> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) throw new Error("Unknown sync result. Run the sync again.");
  const report = await kv().get<SyncReport>(reportKey(reportId));
  if (!report) throw new Error("This sync result expired. Run the sync again.");

  const chosen = new Set(itemIds);
  const out: Pending[] = [];
  for (const item of report.items) {
    if (!chosen.has(item.id) || out.length >= MAX_PROPOSALS) continue;

    const wanted: { tool: string; args: unknown }[] = [];
    if (item.kind === "status") {
      if (item.want) wanted.push({ tool: "update_task", args: { task_id: item.task.id, status: item.want } });
      if (item.ai) wanted.push({ tool: "add_comment", args: { task_id: item.task.id, comment: linkComment(item.pr) } }); // an AI-found link has no id in the PR, so leave the trace in ClickUp
    } else if (item.kind === "pr_no_task" && item.guess && !item.guess.ai) {
      wanted.push({ tool: "add_comment", args: { task_id: item.guess.task.id, comment: linkComment(item.pr) } });
    }

    for (const w of wanted) {
      if (out.length >= MAX_PROPOSALS) break;
      const def = tools.find((t) => t.name === w.tool && t.kind === "write");
      if (!def) continue;
      const parsed = def.schema ? def.schema.parse(w.args) : w.args;
      const { summary, details } = await def.preview!(parsed);
      const pending = await propose(def.name, parsed, summary, details);
      await audit({ event: "proposed", tool: def.name, summary, detail: details });
      out.push(pending);
    }
  }
  return out;
}
