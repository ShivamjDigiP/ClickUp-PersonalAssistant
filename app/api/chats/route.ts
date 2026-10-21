import { connection } from "next/server";
import { listChats, saveChat, validId } from "@/lib/chats";

export async function GET() {
  await connection();
  return Response.json({ chats: await listChats() });
}

// Upsert one session (the client saves after every completed turn).
export async function POST(req: Request) {
  await connection();
  const body = await req.json().catch(() => null);
  if (!body || !validId(body.id) || !Array.isArray(body.bubbles) || !Array.isArray(body.history)) {
    return Response.json({ error: "Invalid chat payload" }, { status: 400 });
  }
  try {
    const chat = await saveChat({ id: body.id, bubbles: body.bubbles, history: body.history, outcomes: body.outcomes ?? {} });
    return Response.json({ chat });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
