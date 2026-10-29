import { connection } from "next/server";
import { withPlatform } from "@/lib/platform/guard";
import { activeWorkspaceId } from "@/lib/platform/workspace";
import { listIntegrations } from "@/lib/integrations/store";
import { loadDataset, unlinkedAccounts } from "@/lib/analytics/load";
import { buildOverview } from "@/lib/analytics/overview";
import { suggestPerson } from "@/lib/integrations/identity";
import { ALL_DAYS } from "@/lib/analytics/types";

// `days=0` is the "All" choice; a missing or unreadable value is the last 30 days
const searchParams0 = (req: Request) => new URL(req.url).searchParams.get("days") === "0";

async function overview(req: Request) {
  await connection();
  const ws = activeWorkspaceId();
  const n = Number(new URL(req.url).searchParams.get("days"));
  const days = n === 0 && searchParams0(req) ? ALL_DAYS : n === 7 || n === 90 ? n : 30;
  const r = new URL(req.url).searchParams.get("role");
  const role = r === "developer" || r === "designer" || r === "client_success" || r === "manager" ? r : undefined;
  const ds = loadDataset(ws);
  const data = buildOverview(ds, Date.now(), days, role);
  const people = ds.people.map((p) => ({ id: p.id, name: p.name }));
  const unlinked = unlinkedAccounts(ws).slice(0, 30).map((u) => ({ ...u, suggestion: suggestPerson({ login: u.externalId, name: u.name, externalId: u.externalId }, people) }));
  return Response.json({ ...data, integrations: listIntegrations(ws), unlinked });
}

export const GET = withPlatform(overview);
