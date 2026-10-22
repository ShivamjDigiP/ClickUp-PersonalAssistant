import { connection } from "next/server";
import { listAccessibleRepos, recentRepos } from "@/lib/git/github";
import { withAuth } from "@/lib/auth/guard";

// For the repo picker: everything the token can see, plus the ones with recent PRs of yours (shown first).
// Empty (not an error) when GitHub is not connected yet.
async function handler() {
  await connection();
  try {
    const [all, recent] = await Promise.all([listAccessibleRepos(), recentRepos().catch(() => [] as string[])]);
    return Response.json({ all, recent, connected: true });
  } catch (e) {
    return Response.json({ all: [], recent: [], connected: !/not connected/i.test((e as Error).message), error: (e as Error).message });
  }
}

export const GET = withAuth(handler);
