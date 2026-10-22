// Turns the browser's cryptic push errors into instructions a person can follow.
// "Registration failed - push service error" means the browser could not reach its push service. The classic cause is
// Brave, which blocks Google's push service until you switch it on; it can also be a network, VPN or firewall rule.
export function explainPushError(e: unknown, isBrave = false): string {
  const err = e as { name?: string; message?: string } | null;
  const msg = err?.message ?? "";

  if (/push service error|registration failed/i.test(msg) || (err?.name === "AbortError" && /push/i.test(msg))) {
    return isBrave
      ? "Brave blocks push notifications by default. Open brave://settings/privacy, turn on “Use Google Services for Push Messaging”, restart Brave, then try again."
      : "Your browser couldn't reach its push service. Check that notifications are allowed and that your network or VPN isn't blocking it, then try again. (The installed iPhone app uses Apple's service and isn't affected.)";
  }
  if (/applicationServerKey|VAPID|not valid|InvalidAccessError/i.test(msg)) {
    return "The server's notification keys look invalid. The app owner should re-check VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.";
  }
  if (err?.name === "NotAllowedError" || /permission/i.test(msg)) {
    return "Notifications are blocked for this app. Allow them in your phone or browser settings, then try again.";
  }
  return msg || "Something went wrong. Please try again.";
}
