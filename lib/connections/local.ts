// Is this request coming from a browser on the same computer the app runs on (http://localhost:3010)?
// Only then may the page inspect or change the Claude Code CLI on this machine. Next.js itself adds x-forwarded-host,
// so that header alone proves nothing: what matters is that every address involved is this computer, and that no
// tunnel or CDN (which add the visitor's real address) is in the path. Hosted deployments never qualify.
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const hostname = (h: string | null) => (h ?? "").split(",")[0].trim().replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();

export function isLocalRequest(req: Request): boolean {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  if (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip")) return false;
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor && !forwardedFor.split(",").every((ip) => LOOPBACK.test(ip.trim()))) return false;
  return [req.headers.get("host"), req.headers.get("x-forwarded-host")].every((h) => !h || hostname(h) === "localhost" || LOOPBACK.test(hostname(h)));
}
