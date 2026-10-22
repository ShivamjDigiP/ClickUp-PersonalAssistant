import { z } from "zod";
import { clickup } from "./client";
import { assignedTo, fetchListTasks, ms, slimTask, summarizeList } from "./data";
import { defaultTeamId, loadHierarchy, resolveLists, resolveScope } from "./resolve";
import { computeMe } from "./me";
import { gitTools } from "../git/tools";

// Every tool is tagged read | write. Write tools never run directly from the LLM:
// they are validated (schema), previewed (preview) and queued in lib/approval/gate.ts.
export type Tool = {
  name: string;
  kind: "read" | "write";
  description: string;
  parameters: Record<string, unknown>;
  run: (args: any) => Promise<unknown>;
  schema?: z.ZodType<any>;
  preview?: (args: any) => Promise<{ summary: string; details?: string }>;
  external?: boolean; // not a ClickUp tool (e.g. GitHub): never retried through the ClickUp MCP
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const dueMs = (d: string) => Date.parse(`${d}T12:00:00Z`);


export const tools: Tool[] = [
  {
    name: "get_workspaces",
    kind: "read",
    description: "List the ClickUp workspaces (teams) the user belongs to.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { teams } = await clickup<{ teams: any[] }>("/team");
      return teams.map((t) => ({ id: t.id, name: t.name }));
    },
  },
  {
    name: "get_hierarchy",
    kind: "read",
    description:
      "List all spaces, folders and lists of a workspace with ids and task counts. 'Projects' usually means lists (or folders). team_id is optional and defaults to the user's first workspace, so call this directly to answer 'how many projects / what spaces / list spaces'.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Optional workspace id" } },
    },
    run: async ({ team_id }) => loadHierarchy(team_id),
  },
  {
    name: "get_tasks",
    kind: "read",
    description:
      "List tasks of a list, folder or space (the current user's tasks unless `scope` says otherwise). Pass its NAME or id in `list` (e.g. 'Imported from Jira'); names are resolved for you. Returns id, name, status, assignees, due date, last update.",
    parameters: {
      type: "object",
      properties: { list: { type: "string", description: "List/folder/space name or id" }, scope: {
          type: "string",
          description: "Whose tasks: 'me' (DEFAULT, the current user), 'team' only if the user asks about everyone / the whole team / a global overview, or a team member's name.",
        }, },
      required: ["list"],
    },
    run: async ({ list, list_id, scope }) => {
      const who = await resolveScope(scope);
      const lists = await resolveLists(list ?? list_id);
      const all = (await Promise.all(lists.map((l) => fetchListTasks(l.id)))).flat();
      const tasks = who.id ? all.filter((t) => assignedTo(t, who.id!)) : all;
      return { scope: who.label, matched: lists.map((l) => `${l.name} (${l.path})`), count: tasks.length, tasks: tasks.slice(0, 150).map(slimTask) };
    },
  },
  {
    name: "get_members",
    kind: "read",
    description: "List members (id, username) of a workspace. Needed to assign tasks.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Optional; defaults to the first workspace" } },
    },
    run: async ({ team_id }) => {
      const id = await defaultTeamId(team_id);
      const { teams } = await clickup<{ teams: any[] }>("/team");
      const team = teams.find((t) => String(t.id) === id);
      return (team?.members ?? []).map((m: any) => ({ id: m.user.id, username: m.user.username }));
    },
  },
  {
    name: "get_my_tasks",
    kind: "read",
    description:
      "Open tasks assigned to the current user across a workspace (for status check-ins). Defaults to the first workspace.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Optional workspace id" } },
    },
    run: async ({ team_id }) => {
      const [{ user }, { teams }] = await Promise.all([
        clickup<{ user: any }>("/user"),
        clickup<{ teams: any[] }>("/team"),
      ]);
      const team = team_id ?? teams[0]?.id;
      const { tasks } = await clickup<{ tasks: any[] }>(`/team/${team}/task`, {
        "assignees": [user.id],
        subtasks: true,
        include_closed: false,
      });
      return { me: user.username, tasks: tasks.map(slimTask) };
    },
  },
  {
    name: "get_task",
    kind: "read",
    description: "Get full details of one task, including description and recent comments.",
    parameters: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
    run: async ({ task_id }) => {
      const [task, comments] = await Promise.all([
        clickup<any>(`/task/${task_id}`),
        clickup<{ comments: any[] }>(`/task/${task_id}/comment`),
      ]);
      return {
        ...slimTask(task),
        description: (task.text_content ?? "").slice(0, 1500),
        comments: comments.comments.slice(0, 5).map((c) => ({
          by: c.user?.username,
          date: ms(c.date),
          text: c.comment_text,
        })),
      };
    },
  },
  {
    name: "get_progress_summary",
    kind: "read",
    description:
      "Computed (not guessed) progress stats: counts per status, overdue tasks, tasks due in 7 days, stale tasks (no update 7+ days), load per assignee. Covers the current user's tasks unless `scope` says otherwise. Pass the NAME or id of a list, folder or space in `list` (names are resolved for you; a folder/space returns one summary per list that has matching tasks).",
    parameters: {
      type: "object",
      properties: { list: { type: "string", description: "List/folder/space name or id" }, scope: {
          type: "string",
          description: "Whose tasks: 'me' (DEFAULT, the current user), 'team' only if the user asks about everyone / the whole team / a global overview, or a team member's name.",
        }, },
      required: ["list"],
    },
    run: async ({ list, list_id, scope }) => {
      const who = await resolveScope(scope);
      const lists = await resolveLists(list ?? list_id);
      const all = await Promise.all(lists.map((l) => summarizeList(l.id, l.name, who.id)));
      const summaries = all.filter((s) => s.total > 0); // skip lists where this person has nothing
      return {
        scope: who.label,
        matched: lists.map((l) => `${l.name} (${l.path})`),
        ...(summaries.length ? {} : { note: `${who.label} has no tasks in the matched lists.` }),
        summaries,
      };
    },
  },
  {
    name: "get_my_stats",
    kind: "read",
    description:
      "The current user's own work stats, computed from ClickUp: projects they are in, backlog vs in-progress vs done, tasks completed in the last N days (vs the period before), impact points, on-time rate, median cycle time, streak, tracked hours, and insights. Use for questions about 'me', 'my work', 'my impact', 'my backlog'.",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Period in days: 7, 30 or 90 (default 30)" } },
    },
    run: async ({ days }) => {
      const s = await computeMe([7, 30, 90].includes(days) ? days : 30);
      // trimmed for the model: the long per-day arrays are only for charts
      const { heat: _heat, weekly, effort, ...rest } = s;
      void _heat;
      return { ...rest, weekly, effort: { tracked: effort.tracked, hours: effort.hours, byProject: effort.byProject } };
    },
  },

  // ---- WRITE tools: proposals only, executed after the user approves ----
  {
    name: "create_task",
    kind: "write",
    description: "Propose creating a task in a list. Needs user approval before it happens.",
    parameters: {
      type: "object",
      properties: {
        list_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", description: "Exact status name of the list" },
        assignee_ids: { type: "array", items: { type: "number" } },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        priority: { type: "number", description: "1 urgent, 2 high, 3 normal, 4 low" },
      },
      required: ["list_id", "name"],
    },
    schema: z.object({
      list_id: z.string(),
      name: z.string().min(1),
      description: z.string().optional(),
      status: z.string().optional(),
      assignee_ids: z.array(z.number()).optional(),
      due_date: dateStr.optional(),
      priority: z.number().int().min(1).max(4).optional(),
    }),
    preview: async (a) => {
      const list = await clickup<any>(`/list/${a.list_id}`);
      const lines = [`List: ${list.name}`, `Name: ${a.name}`];
      if (a.status) lines.push(`Status: ${a.status}`);
      if (a.due_date) lines.push(`Due: ${a.due_date}`);
      if (a.assignee_ids?.length) lines.push(`Assignees: ${a.assignee_ids.join(", ")}`);
      return { summary: `Create task "${a.name}" in ${list.name}`, details: lines.join("\n") };
    },
    run: async ({ list_id, due_date, assignee_ids, ...rest }) => {
      const t = await clickup<any>(
        `/list/${list_id}/task`,
        {},
        { method: "POST", body: { ...rest, assignees: assignee_ids, due_date: due_date && dueMs(due_date) } },
      );
      return { id: t.id, url: t.url };
    },
  },
  {
    name: "update_task",
    kind: "write",
    description:
      "Propose changing a task (status, name, description, due date, priority, assignees). Needs user approval before it happens.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", description: "Exact status name used by the task's list" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        priority: { type: "number", description: "1 urgent, 2 high, 3 normal, 4 low" },
        add_assignee_ids: { type: "array", items: { type: "number" } },
        remove_assignee_ids: { type: "array", items: { type: "number" } },
      },
      required: ["task_id"],
    },
    schema: z
      .object({
        task_id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        due_date: dateStr.optional(),
        priority: z.number().int().min(1).max(4).optional(),
        add_assignee_ids: z.array(z.number()).optional(),
        remove_assignee_ids: z.array(z.number()).optional(),
      })
      .refine((a) => Object.keys(a).length > 1, "nothing to change"),
    preview: async (a) => {
      const t = slimTask(await clickup<any>(`/task/${a.task_id}`));
      const lines: string[] = [];
      if (a.status) lines.push(`Status: ${t.status} → ${a.status}`);
      if (a.name) lines.push(`Name: ${t.name} → ${a.name}`);
      if (a.due_date) lines.push(`Due: ${t.due ?? "none"} → ${a.due_date}`);
      if (a.priority) lines.push(`Priority: ${t.priority ?? "none"} → ${a.priority}`);
      if (a.description) lines.push("Description: replaced");
      if (a.add_assignee_ids?.length) lines.push(`Add assignees: ${a.add_assignee_ids.join(", ")}`);
      if (a.remove_assignee_ids?.length) lines.push(`Remove assignees: ${a.remove_assignee_ids.join(", ")}`);
      return { summary: `Update task "${t.name}"`, details: lines.join("\n") };
    },
    run: async ({ task_id, due_date, add_assignee_ids, remove_assignee_ids, ...rest }) => {
      const body: Record<string, unknown> = { ...rest };
      if (due_date) body.due_date = dueMs(due_date);
      if (add_assignee_ids || remove_assignee_ids) body.assignees = { add: add_assignee_ids ?? [], rem: remove_assignee_ids ?? [] };
      const t = await clickup<any>(`/task/${task_id}`, {}, { method: "PUT", body });
      return { id: t.id, status: t.status?.status };
    },
  },
  {
    name: "add_comment",
    kind: "write",
    description: "Propose adding a comment to a task. Needs user approval before it happens.",
    parameters: {
      type: "object",
      properties: { task_id: { type: "string" }, comment: { type: "string" } },
      required: ["task_id", "comment"],
    },
    schema: z.object({ task_id: z.string(), comment: z.string().min(1) }),
    preview: async (a) => {
      const t = await clickup<any>(`/task/${a.task_id}`);
      return { summary: `Comment on "${t.name}"`, details: a.comment };
    },
    run: async ({ task_id, comment }) => {
      await clickup(`/task/${task_id}/comment`, {}, { method: "POST", body: { comment_text: comment } });
      return { ok: true };
    },
  },
  ...gitTools,
];
