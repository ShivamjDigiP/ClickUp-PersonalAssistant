import webpush from "web-push";
import { reportError } from "../observability";
import type { PushSub } from "./store";

// Sending a push message. Needs VAPID keys (generated once with `npx web-push generate-vapid-keys`): they prove to the
// browsers' push services that the messages really come from this app.
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let initialised = false;
function init() {
  if (initialised) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  initialised = true;
}

export type Payload = { title: string; body: string; url: string; tag: string };
export type SendResult = "sent" | "gone" | "error";

export async function sendPush(sub: PushSub, payload: Payload): Promise<SendResult> {
  try {
    init();
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" });
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone"; // the person removed the app or revoked permission
    reportError(e, "push send");
    return "error";
  }
}
