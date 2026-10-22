import { connection } from "next/server";
import { listTasks, lookupTask } from "@/lib/pr-comments/candidates";
import { withAuth } from "@/lib/auth/guard";

export const maxDuration = 30;

// The person's tasks to choose from. `?link=` checks one pasted ClickUp task link or id (for a task that is not in the list).
async function handler(req: Request) {
  await connection();
  const link = new URL(req.url).searchParams.get("link");
  try {
    if (link) {
      const id = link.trim().match(/(?:\/t\/(?:\d+\/)?|^CU-|^)([a-z0-9]{6,12})\/?$/i)?.[1];
      if (!id) return Response.json({ error: "Paste a ClickUp task link or its id." }, { status: 400 });
      return Response.json({ task: await lookupTask(id) });
    }
    return Response.json({ tasks: await listTasks() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export const GET = withAuth(handler);
