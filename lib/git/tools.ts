import type { Tool } from "../clickup/tools";
import { getPr, listMyPrs, recentCommits } from "./github";

// Read-only code context. Changing ClickUp from what these show still goes through update_task / add_comment and the approval gate.
export const gitTools: Tool[] = [
  {
    name: "get_my_prs",
    kind: "read",
    external: true,
    description:
      "List the user's GitHub pull requests updated recently, with state (open/merged/closed) and any ClickUp task ids found in the title or description. Use for 'what did I ship', 'which tasks should move', or PR sync.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "closed", "all"], description: "Default all. 'closed' includes merged." },
        days: { type: "number", description: "Look back this many days (default 14, max 90)" },
      },
    },
    run: async ({ state, days }) => ({
      prs: await listMyPrs(["open", "closed"].includes(state) ? state : "all", Math.min(Math.max(Number(days) || 14, 1), 90)),
    }),
  },
  {
    name: "get_pr",
    kind: "read",
    external: true,
    description: "Get any one pull request by repo and number (or from a GitHub PR link the user gives: github.com/owner/repo/pull/N): description, branch, commits, size and the ClickUp task ids it references.",
    parameters: {
      type: "object",
      properties: { repo: { type: "string", description: "owner/name" }, number: { type: "number" } },
      required: ["repo", "number"],
    },
    run: ({ repo, number }) => getPr(String(repo), Number(number)),
  },
  {
    name: "get_recent_commits",
    kind: "read",
    external: true,
    description: "List the user's own recent commits in one repository, with any ClickUp task ids in the messages.",
    parameters: {
      type: "object",
      properties: { repo: { type: "string", description: "owner/name" }, days: { type: "number", description: "Default 7, max 60" } },
      required: ["repo"],
    },
    run: async ({ repo, days }) => ({ commits: await recentCommits(String(repo), Math.min(Math.max(Number(days) || 7, 1), 60)) }),
  },
];
