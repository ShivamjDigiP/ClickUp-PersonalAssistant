import { AsyncLocalStorage } from "node:async_hooks";

// Who is making the current request. Set once at the edge of each API route (see guard.ts) and read deep inside
// (ClickUp client, storage keys, caches), so no function needs a "user" argument passed through every layer.
export type AuthCtx = {
  userId: string; // "local" = single-user mode without sign-in
  token: string; // the person's ClickUp token (decrypted just for this request)
  scheme: "raw" | "bearer"; // personal tokens are sent as-is, OAuth tokens as "Bearer <token>"
  email?: string;
  name?: string;
};

const g = globalThis as unknown as { __authAls?: AsyncLocalStorage<AuthCtx> };
const als = (g.__authAls ??= new AsyncLocalStorage<AuthCtx>()); // one instance even if bundled into several route files

export const runAs = <T,>(ctx: AuthCtx, fn: () => T): T => als.run(ctx, fn);
export const currentAuth = () => als.getStore();
export const authKey = () => als.getStore()?.userId ?? "local";

// Every stored item belongs to one person. "local" keeps the original keys so existing local data keeps working.
export const ns = (key: string) => {
  const a = als.getStore();
  return a && a.userId !== "local" ? `u/${a.userId}/${key}` : key;
};
