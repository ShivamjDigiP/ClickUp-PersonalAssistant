import { connection } from "next/server";
import { deleteChat, getChat } from "@/lib/chats";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const chat = await getChat((await params).id);
  return chat ? Response.json({ chat }) : Response.json({ error: "Chat not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  await deleteChat((await params).id);
  return Response.json({ ok: true });
}
