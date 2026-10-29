import type { NormCommit, NormPr } from "../lib/integrations/types";

// Builders for test data: only say what matters to the test.
export const nc = (o: Partial<NormCommit> & Pick<NormCommit, "repo" | "sha">): NormCommit => ({ author: null, at: Date.now(), message: "feat: something", additions: 0, deletions: 0, ...o });

export const npr = (o: Partial<NormPr> & Pick<NormPr, "repo" | "number">): NormPr => ({
  author: null, title: "A change", state: "merged", baseBranch: "develop", headBranch: "feat/x", labels: [], openedAt: Date.now(), commitCount: 1,
  reviewRounds: 0, approvals: 1, reviewed: true, changelogItems: 0, additions: 0, deletions: 0, ...o,
});
