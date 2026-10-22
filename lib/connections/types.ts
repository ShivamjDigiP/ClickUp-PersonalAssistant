// One row on the Connections tab. `off` = not set up (optional), `down` = set up but not working.
export type ConnectionState = "ok" | "warn" | "down" | "off";

// What the person can do about a card, right from the web page.
export type ConnectionAction =
  | { type: "token"; endpoint: string; label: string; placeholder: string; helpUrl: string; helpLabel: string }
  | { type: "run"; endpoint: string; label: string }
  | { type: "copy"; label: string; command: string };

export type Connection = {
  id: string;
  label: string;
  state: ConnectionState;
  detail: string;
  checkedAt: string;
  action?: ConnectionAction;
  more?: ConnectionAction[]; // other ways to connect, shown as extra buttons
  disconnect?: string; // endpoint that removes a connection made from this page
};

export const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);

export const result = (
  id: string,
  label: string,
  state: ConnectionState,
  detail: string,
  extra: Pick<Connection, "action" | "more" | "disconnect"> = {},
): Connection => ({ id, label, state, detail, checkedAt: new Date().toISOString(), ...extra });
