import { connection } from "next/server";
import { listChats, saveChat, validId } from "@/lib/chats";
import { withAuth } from "@/lib/auth/guard";
import { reportError } from "@/lib/observability";

async function list() {
  await connection();
  return Response.json({ chats: await listChats() });
}

// Upsert one session (the client saves after every completed turn).
async function save(req: Request) {
  await connection();
  const body = await req.json().catch(() => null);
  if (!body || !validId(body.id) || !Array.isArray(body.bubbles) || !Array.isArray(body.history)) {
    return Response.json({ error: "Invalid chat payload" }, { status: 400 });
  }
  try {
    const chat = await saveChat({ id: body.id, bubbles: body.bubbles, history: body.history, outcomes: body.outcomes ?? {} });
    return Response.json({ chat });
  } catch (e) {
    reportError(e, "api/chats save");
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = withAuth(list);
export const POST = withAuth(save);
