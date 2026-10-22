import { connection } from "next/server";
import { deleteChat, getChat } from "@/lib/chats";
import { withAuth } from "@/lib/auth/guard";

type Ctx = { params: Promise<{ id: string }> };

async function read(_req: Request, { params }: Ctx) {
  await connection();
  const chat = await getChat((await params).id);
  return chat ? Response.json({ chat }) : Response.json({ error: "Chat not found" }, { status: 404 });
}

async function remove(_req: Request, { params }: Ctx) {
  await connection();
  await deleteChat((await params).id);
  return Response.json({ ok: true });
}

export const GET = withAuth(read);
export const DELETE = withAuth(remove);
