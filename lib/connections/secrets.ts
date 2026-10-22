import { kv } from "../kv";
import { ns } from "../auth/context";
import { authEnabled } from "../auth/config";
import { decrypt, encrypt } from "../auth/crypto";

// Tokens a person connects from the web page (GitHub, AI keys). They are saved to storage under that person's own
// account (a file on this computer, or Redis when deployed), encrypted whenever sign-in is on, with no expiry. So they
// survive server restarts and sign-out, and are only removed by "Disconnect". They are never sent back to the browser.
const key = (name: string) => ns(`integrations/${name}`);

type Stored = { v: string; at?: string };

export async function saveSecret(name: string, value: string) {
  await kv().set(key(name), { v: authEnabled() ? encrypt(value) : value, at: new Date().toISOString() } satisfies Stored);
}

async function load(name: string): Promise<Stored | null> {
  try {
    const rec = await kv().get<Stored>(key(name));
    return rec?.v ? rec : null;
  } catch {
    return null;
  }
}

export async function readSecret(name: string): Promise<string | null> {
  const rec = await load(name);
  if (!rec) return null;
  try {
    return authEnabled() ? decrypt(rec.v) : rec.v;
  } catch {
    return null;
  }
}

// When did the person save it, and can it still be read? A key saved under a different AUTH_SECRET cannot be decrypted:
// say so, rather than silently looking like it was never saved.
export async function secretInfo(name: string): Promise<{ savedAt: string | null; unreadable: boolean } | null> {
  const rec = await load(name);
  if (!rec) return null;
  try {
    if (authEnabled()) decrypt(rec.v);
    return { savedAt: rec.at ?? null, unreadable: false };
  } catch {
    return { savedAt: rec.at ?? null, unreadable: true };
  }
}

export const removeSecret = (name: string) => kv().del(key(name));

export const durableStorage = () => kv().kind !== "memory";
