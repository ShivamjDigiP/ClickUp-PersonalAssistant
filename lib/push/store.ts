import { kv } from "../kv";
import { authEnabled } from "../auth/config";
import { decrypt, encrypt } from "../auth/crypto";
import { safeTz, type Prefs } from "./schedule";

// One record per person who turned the daily digest on. It is stored under "digest/<ClickUp user id>" (not inside the
// per-person "u/…" area) because the scheduler has to find everyone who wants a digest.
// It holds the person's ENCRYPTED ClickUp token: the scheduler runs while they are away, so it needs a way to read
// their tasks. Turning the digest off deletes the record, and the token with it.
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string }; label?: string; createdAt: string };

export type DigestRecord = Prefs & {
  userId: string;
  name: string;
  scheme: "raw" | "bearer";
  enc?: string; // encrypted token (absent in single-user local mode, where the scheduler uses .env.local)
  subs: PushSub[];
  lastSent?: string; // local date of the last digest, so it is never sent twice in a day
  createdAt: string;
};

const key = (userId: string) => `digest/${userId}`;
const MAX_DEVICES = 5;

export const getDigest = (userId: string) => kv().get<DigestRecord>(key(userId));
export const saveRecord = (rec: DigestRecord) => kv().set(key(rec.userId), rec);
export const deleteDigest = (userId: string) => kv().del(key(userId));

export async function listDigests(): Promise<DigestRecord[]> {
  const ids = await kv().keys("digest/");
  const all = await Promise.all(ids.map((k) => kv().get<DigestRecord>(k)));
  return all.filter((r): r is DigestRecord => !!r);
}

// A browser's subscription must look exactly like one before we store it or call out to it.
export function parseSubscription(raw: unknown, label?: string): PushSub | null {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
  try {
    const url = new URL(s.endpoint);
    if (url.protocol !== "https:") return null; // push services are always HTTPS; blocks pointing the server at internal addresses
  } catch {
    return null;
  }
  if (s.endpoint.length > 1000) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, label: label?.slice(0, 80), createdAt: new Date().toISOString() };
}

export type SaveInput = { userId: string; name: string; token: string; scheme: "raw" | "bearer"; prefs: Prefs; sub?: PushSub };

export async function saveDigest(input: SaveInput): Promise<DigestRecord> {
  const prev = await getDigest(input.userId);
  const subs = [...(prev?.subs ?? []).filter((s) => s.endpoint !== input.sub?.endpoint), ...(input.sub ? [input.sub] : [])].slice(-MAX_DEVICES);
  const rec: DigestRecord = {
    userId: input.userId,
    name: input.name,
    scheme: input.scheme,
    enc: authEnabled() && input.token ? encrypt(input.token) : undefined,
    hour: input.prefs.hour,
    tz: safeTz(input.prefs.tz),
    weekdaysOnly: input.prefs.weekdaysOnly,
    subs,
    lastSent: prev?.lastSent,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
  };
  await kv().set(key(input.userId), rec);
  return rec;
}

export const tokenOf = (rec: DigestRecord): string => (rec.enc ? decrypt(rec.enc) : (process.env.CLICKUP_API_TOKEN ?? ""));
