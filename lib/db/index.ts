import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations";

// The platform's relational store. SQLite for development (Node's built-in node:sqlite, no extra package); all SQL lives
// in the repository files next to this one, so moving to Postgres later only touches those.
type Db = DatabaseSync;
const g = globalThis as unknown as { __platformDb?: Db };

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${m.id} (${m.name}) failed: ${(e as Error).message}`);
    }
  }
}

// Shared connection, kept on globalThis so dev hot reloads do not open a new one each time.
export function db(): Db {
  return (g.__platformDb ??= openDb(process.env.PLATFORM_DB || path.join(process.cwd(), "data", "platform.db")));
}

// Runs fn inside one transaction: all or nothing (a sync either lands completely or not at all).
export function tx<T>(fn: () => T, d: Db = db()): T {
  d.exec("BEGIN");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
