import { promises as fs } from "fs";
import path from "path";

// Tiny JSON-file persistence for the local POC/MVP (data/ is git-ignored).
// In the AWS phase this file is the only thing swapped for DynamoDB.
const DIR = path.join(process.cwd(), "data");

async function read<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function write(file: string, value: unknown) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, file), JSON.stringify(value, null, 2));
}

export type Settings = { readOnly: boolean };

// Safe default: read-only until the user switches writes on.
export const getSettings = () => read<Settings>("settings.json", { readOnly: true });
export const setSettings = (s: Settings) => write("settings.json", s);

export type AuditEntry = {
  at: string;
  event: "proposed" | "approved" | "rejected" | "executed" | "failed" | "blocked" | "expired";
  tool: string;
  summary: string;
  detail?: string;
};

export async function audit(entry: Omit<AuditEntry, "at">) {
  const log = await read<AuditEntry[]>("audit.json", []);
  log.push({ at: new Date().toISOString(), ...entry });
  await write("audit.json", log.slice(-500));
}

export const readAudit = async (limit = 50) => (await read<AuditEntry[]>("audit.json", [])).slice(-limit).reverse();
