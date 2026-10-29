import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { PersonHint } from "./types";

// The same human appears as a ClickUp user, a GitHub login and a Jira account. Linking them is what lets one
// developer's tasks and commits add up. Rules, in order, and only when they are certain:
//   1. same e-mail address as someone already known  2. same full name  3. otherwise a task tool creates a new person;
//   a GitHub login that matches nobody stays "unlinked" for the CXO to assign (guessing would mix people up).
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ROSTER = new Set(["clickup", "jira"]); // tools that define who is on the team
const real = (email?: string | null) => (email && !/noreply|no-reply/i.test(email) ? email.toLowerCase() : null);

export const hintKey = (h: Pick<PersonHint, "provider" | "externalId">) => `${h.provider}:${h.externalId}`;

export function linkIdentities(workspaceId: string, hints: PersonHint[], now: number): Map<string, string> {
  const d = db();
  const out = new Map<string, string>();
  const findIdentity = d.prepare("SELECT id, person_id FROM identities WHERE workspace_id = ? AND provider = ? AND external_id = ?");
  const insertIdentity = d.prepare("INSERT INTO identities (id, workspace_id, provider, external_id, display_name, email, login, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const updateIdentity = d.prepare("UPDATE identities SET display_name = COALESCE(?, display_name), email = COALESCE(?, email), login = COALESCE(?, login) WHERE id = ?");
  const personByEmail = d.prepare("SELECT id FROM people WHERE workspace_id = ? AND lower(email) = ?");
  const personByEmailViaIdentity = d.prepare("SELECT person_id AS id FROM identities WHERE workspace_id = ? AND lower(email) = ? AND person_id IS NOT NULL LIMIT 1");
  const people = d.prepare("SELECT id, name FROM people WHERE workspace_id = ? AND active = 1");
  const insertPerson = d.prepare("INSERT INTO people (id, workspace_id, name, email, level, start_date, created_at) VALUES (?, ?, ?, ?, 'mid', ?, ?)");
  const setPerson = d.prepare("UPDATE identities SET person_id = ? WHERE id = ?");

  for (const h of hints) {
    const email = real(h.email);
    const found = findIdentity.get(workspaceId, h.provider, h.externalId) as { id: string; person_id: string | null } | undefined;
    let id = found?.id;
    let personId = found?.person_id ?? null;
    if (!id) {
      id = randomUUID();
      insertIdentity.run(id, workspaceId, h.provider, h.externalId, h.name ?? null, email, h.login ?? null, null);
    } else {
      updateIdentity.run(h.name ?? null, email, h.login ?? null, id);
    }

    if (!personId) {
      if (email) personId = ((personByEmail.get(workspaceId, email) ?? personByEmailViaIdentity.get(workspaceId, email)) as { id: string } | undefined)?.id ?? null;
      if (!personId && h.name) {
        const hit = (people.all(workspaceId) as { id: string; name: string }[]).filter((p) => norm(p.name) === norm(h.name));
        if (hit.length === 1) personId = hit[0].id; // exactly one: two people with one name would be a guess
      }
      if (!personId && ROSTER.has(h.provider) && h.name) {
        personId = randomUUID();
        insertPerson.run(personId, workspaceId, h.name, email, now, now);
      }
      if (personId) setPerson.run(personId, id);
    }
    out.set(hintKey(h), id);
  }
  return out;
}

// A person's start date is the earliest thing we know about them, until the CXO sets the real one.
export function backfillStartDates(workspaceId: string) {
  db()
    .prepare(
      `UPDATE people SET start_date = (
         SELECT MIN(t.created_at) FROM tasks t JOIN identities i ON i.id = t.identity_id WHERE i.person_id = people.id
       ) WHERE workspace_id = ? AND (
         SELECT MIN(t.created_at) FROM tasks t JOIN identities i ON i.id = t.identity_id WHERE i.person_id = people.id
       ) < start_date`,
    )
    .run(workspaceId);
}

// ---- suggestions for accounts nobody has been matched to -------------------------------------------------------------
// Logins like "YashpDigiP" cannot be matched with certainty to "Yash Pattnaik", so they are only SUGGESTED, with the
// reason, for the CXO to confirm. Nothing here is applied automatically.
const NOISE = /(digip|digiprodigy|dev|developer|gh|github|code|the|real|official|\d+)/g;

export type Suggestion = { personId: string; name: string; confidence: number; reason: string };

export function suggestPerson(account: { login?: string | null; name?: string | null; externalId: string }, people: { id: string; name: string }[]): Suggestion | null {
  const handle = norm(account.login ?? account.externalId).replace(/ /g, "").replace(NOISE, "");
  if (handle.length < 3) return null;
  const scored = people
    .map((p) => {
      const parts = norm(p.name).split(" ").filter(Boolean);
      const first = parts[0] ?? "";
      const last = parts[parts.length - 1] ?? "";
      let score = 0;
      let reason = "";
      if (first.length >= 3 && handle.startsWith(first)) {
        score = 0.6;
        reason = `login starts with "${first}"`;
        const rest = handle.slice(first.length);
        if (last && last !== first && rest.startsWith(last[0])) {
          score += rest.startsWith(last) ? 0.4 : 0.25;
          reason += rest.startsWith(last) ? ` and continues with "${last}"` : ` followed by "${last[0]}", the initial of "${last}"`;
        }
      } else if (last.length >= 4 && handle.includes(last)) {
        score = 0.5;
        reason = `login contains "${last}"`;
      }
      return { personId: p.id, name: p.name, confidence: Math.min(0.95, score), reason };
    })
    .filter((s) => s.confidence >= 0.6)
    .sort((a, b) => b.confidence - a.confidence);
  // a tie between two people is a guess: say nothing rather than point at the wrong one
  if (scored.length > 1 && scored[0].confidence - scored[1].confidence < 0.2) return null;
  return scored[0] ?? null;
}

export function linkIdentity(workspaceId: string, identityId: string, personId: string | null): boolean {
  const d = db();
  if (personId && !d.prepare("SELECT 1 FROM people WHERE id = ? AND workspace_id = ?").get(personId, workspaceId)) return false;
  return d.prepare("UPDATE identities SET person_id = ? WHERE id = ? AND workspace_id = ?").run(personId, identityId, workspaceId).changes > 0;
}
