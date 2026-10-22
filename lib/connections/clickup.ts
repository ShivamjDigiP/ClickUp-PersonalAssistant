import { clickup } from "../clickup/client";
import { result, withTimeout } from "./types";

export async function checkClickUp() {
  try {
    const [{ user }, { teams }] = await withTimeout(Promise.all([clickup<{ user: any }>("/user"), clickup<{ teams: any[] }>("/team")]), 8000, "ClickUp");
    const n = teams.length;
    return result("clickup", "ClickUp API", "ok", `Signed in as ${user.username}. ${n} workspace${n === 1 ? "" : "s"} reachable.`);
  } catch (e) {
    const msg = (e as Error).message;
    return result("clickup", "ClickUp API", "down", /not set|no token/i.test(msg) ? msg : `Cannot reach ClickUp: ${msg}`);
  }
}
