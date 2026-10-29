import { AsyncLocalStorage } from "node:async_hooks";

// Who is making the current platform request, set once at the edge of each /api/cxo route (see guard.ts).
export type Role = "owner" | "cxo" | "manager" | "developer";
export type PlatformCtx = { userId: string; workspaceId: string; role: Role; name: string; email: string };

const g = globalThis as unknown as { __platformAls?: AsyncLocalStorage<PlatformCtx> };
const als = (g.__platformAls ??= new AsyncLocalStorage<PlatformCtx>());

export const runAsPlatform = <T,>(ctx: PlatformCtx, fn: () => T): T => als.run(ctx, fn);
export const currentPlatform = () => als.getStore();

export function requirePlatform(): PlatformCtx {
  const c = als.getStore();
  if (!c) throw new Error("Not signed in to the platform");
  return c;
}
