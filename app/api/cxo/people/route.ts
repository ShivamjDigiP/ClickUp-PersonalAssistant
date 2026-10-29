import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { db } from "@/lib/db";
import { persistFirstInteractions, unlinkedAccounts } from "@/lib/analytics/load";
import { suggestPerson } from "@/lib/integrations/identity";

// Everyone in the workspace (including people hidden from the team stats), the tool accounts linked to each, and the
// accounts nobody is matched to yet, with a suggested owner where the name makes it likely.
async function people() {
  await connection();
  const ws = activeWorkspaceId();
  const d = db();
  persistFirstInteractions(ws); // first interaction = earliest task or commit; no one types a start date
  const rows = d.prepare("SELECT id, name, email, level, role, start_date AS firstInteraction, active FROM people WHERE workspace_id = ? ORDER BY active DESC, name COLLATE NOCASE").all(ws) as { id: string; name: string; email: string | null; level: string; role: string | null; firstInteraction: number; active: number }[];
  const accounts = d
    .prepare(
      `SELECT i.id, i.provider, i.external_id AS externalId, i.display_name AS name, i.login, i.person_id AS personId,
         (SELECT COUNT(*) FROM commits c WHERE c.identity_id = i.id) AS commits,
         (SELECT COUNT(*) FROM tasks t WHERE t.identity_id = i.id) AS tasks
       FROM identities i WHERE i.workspace_id = ? AND i.person_id IS NOT NULL`,
    )
    .all(ws) as { id: string; provider: string; externalId: string; name: string | null; login: string | null; personId: string; commits: number; tasks: number }[];

  const list = rows.map((p) => ({ ...p, active: !!p.active, accounts: accounts.filter((a) => a.personId === p.id) }));
  const candidates = list.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  const unlinked = unlinkedAccounts(ws).map((u) => ({ ...u, suggestion: suggestPerson({ login: u.externalId, name: u.name, externalId: u.externalId }, candidates) }));
  return Response.json({ people: list, unlinked });
}

export const GET = withPlatform(people);
