import { checkHealth } from "../healthcheck";
import { pushConfigured } from "../push/send";
import { result } from "./types";

export async function checkStorage() {
  const h = await checkHealth();
  const { storage } = h;
  if (!storage.ok) return result("storage", "Storage", h.status === "degraded" ? "warn" : "down", storage.note ?? "Storage is not responding.");
  return result("storage", "Storage", "ok", `${storage.backend} storage responding in ${storage.ms} ms.`);
}

export function checkPush() {
  return pushConfigured()
    ? result("push", "Notifications", "ok", "Push keys are configured for the daily digest.")
    : result("push", "Notifications", "off", "Not set up. Add VAPID keys in .env.local to enable the daily digest.");
}

export function checkSentry() {
  return process.env.SENTRY_DSN
    ? result("sentry", "Error tracking", "ok", "Sentry will receive error reports.")
    : result("sentry", "Error tracking", "off", "Not set up. Set SENTRY_DSN to receive error reports.");
}
