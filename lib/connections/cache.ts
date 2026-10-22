import { kv } from "../kv";
import { ns } from "../auth/context";
import type { Connection } from "./types";

// Connection results are remembered per person until they press Refresh or change a connection, so opening the tab
// never re-runs the checks. The TTL is only a safety net so a forgotten result cannot stay stale for days.
const TTL_SEC = 6 * 3600;
// Whether the browser is on the app's own computer changes the Claude Code cards, so each has its own entry.
const key = (local: boolean) => ns(`connections/cache/${local ? "local" : "remote"}`);

export async function readCached(local: boolean): Promise<Connection[] | null> {
  try {
    return await kv().get<Connection[]>(key(local));
  } catch {
    return null;
  }
}

export async function writeCached(local: boolean, items: Connection[]) {
  try {
    await kv().set(key(local), items, TTL_SEC);
  } catch {
    /* caching is an optimisation; a storage hiccup must not break the tab */
  }
}
