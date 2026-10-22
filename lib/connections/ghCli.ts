import { execFile } from "node:child_process";

// The token the GitHub CLI (`gh`) is signed in with on this computer. It usually already has access to the person's
// organisations (including SSO authorisation), unlike a hand-made fine-grained token owned by a personal account.
export function ghToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", ["auth", "token"], { timeout: 10_000, shell: true, windowsHide: true }, (err, stdout) => {
      const token = String(stdout ?? "").trim();
      if (err || !token) return reject(new Error("The GitHub CLI is not installed or not signed in. Run `gh auth login` in a terminal first."));
      resolve(token);
    });
  });
}
