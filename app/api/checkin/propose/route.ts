import { clickup } from "@/lib/clickup/client";
import { tools } from "@/lib/clickup/tools";
import { propose } from "@/lib/approval/gate";
import { audit, getSettings } from "@/lib/store";

// Turns a check-in swipe into a *proposal* (never executes). The user approves in the review step.
export async function POST(req: Request) {
  const { task_id, action, note } = (await req.json()) as {
    task_id: string;
    action: "done" | "blocked" | "note";
    note?: string;
  };
  if ((await getSettings()).readOnly) {
    return Response.json({ error: "Read-only mode is on." }, { status: 403 });
  }

  try {
    let toolName: "update_task" | "add_comment";
    let args: Record<string, unknown>;

    if (action === "done") {
      const task = await clickup<any>(`/task/${task_id}`);
      const list = await clickup<{ statuses: any[] }>(`/list/${task.list.id}`);
      const closed =
        list.statuses.find((s) => s.type === "closed") ?? list.statuses.find((s) => s.type === "done");
      if (!closed) throw new Error("This list has no 'done' status.");
      toolName = "update_task";
      args = { task_id, status: closed.status };
    } else {
      const text = (note ?? "").trim();
      if (!text) throw new Error("A note is required.");
      toolName = "add_comment";
      args = { task_id, comment: action === "blocked" ? `🚧 Blocked: ${text}` : text };
    }

    const tool = tools.find((t) => t.name === toolName)!;
    const parsed = tool.schema!.parse(args);
    const { summary, details } = await tool.preview!(parsed);
    const p = await propose(toolName, parsed, summary, details);
    await audit({ event: "proposed", tool: toolName, summary, detail: details });
    return Response.json({ proposal: p });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
