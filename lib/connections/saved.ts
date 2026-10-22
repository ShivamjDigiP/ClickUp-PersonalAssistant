import { durableStorage, secretInfo } from "./secrets";

export const UNREADABLE = "A saved key exists but cannot be read (the server's AUTH_SECRET changed). Paste it again to replace it.";

// "Saved 22 Oct. Stays connected after restarts and sign-out." (or a warning when storage would forget it)
export async function savedNote(name: string): Promise<string> {
  const info = await secretInfo(name);
  const when = info?.savedAt ? new Date(info.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
  if (!durableStorage()) return " Warning: this server has no permanent storage, so it will be forgotten on restart. Set up Redis.";
  return ` ${when ? `Saved ${when}. ` : ""}Stays connected after restarts and sign-out.`;
}
