// What a change WAS, read from what people wrote (commit messages, PR titles, labels, branch names, the changelog in the
// PR description) and how widely it reached (files touched, changelog items). Deliberately NOT lines of code: those reward
// verbosity, generated files and copy-paste, and say nothing about whether the work was valuable.
export type ChangeKind = "feature" | "fix" | "refactor" | "docs" | "test" | "chore" | "merge" | "revert" | "other";
export type Scope = "small" | "medium" | "large" | "bulk";

const PREFIX: Record<string, ChangeKind> = {
  feat: "feature", feature: "feature", fix: "fix", bugfix: "fix", hotfix: "fix", refactor: "refactor", perf: "refactor",
  doc: "docs", docs: "docs", test: "test", tests: "test", chore: "chore", build: "chore", ci: "chore", style: "chore", revert: "revert",
};
const CONVENTIONAL = /^(feat|feature|fix|bugfix|hotfix|refactor|perf|docs?|tests?|chore|build|ci|style|revert)(\([^)]*\))?!?:\s*/i;
const BRANCH = /^(feat|feature|fix|bugfix|hotfix|refactor|chore|docs?|test|release)\//i;

const RULES: [ChangeKind, RegExp][] = [
  ["merge", /^merge\b|^merged\b/i],
  ["revert", /^revert\b/i],
  ["chore", /\b(bump|upgrade[sd]?|update[sd]? (deps?|dependenc\w*|packages?|version)|dependenc\w*|lockfile|package-lock|yarn\.lock|prettier|lint(ing)?|eslint|format(ting)?|whitespace|typos?|rename file|gitignore|\.env)\b/i],
  ["fix", /\b(fix(es|ed|ing)?|bugs?|hotfix|patch(ed)?|resolv(e|es|ed)|crash(es)?|error|broken|regression|issues?)\b/i],
  ["test", /\b(tests?|spec|coverage|jest|cypress)\b/i],
  ["docs", /\b(docs?|documentation|readme|changelog|comments?)\b/i],
  ["refactor", /\b(refactor(ed|ing)?|clean ?up|restructur\w*|simplif\w*|reorgani[sz]\w*|optimi[sz]\w*|performance|move[sd]?|renam\w*)\b/i],
  ["feature", /\b(add(s|ed|ing)?|implement\w*|creat(e|es|ed|ing)|introduc\w*|new|support(s|ed)?|enable[sd]?|integrat\w*|build)\b/i],
];

// Messages that say nothing ("wip", "update", "fix", "temp") are not trivial work, but they cannot be credited as a described change either.
const VAGUE = /^(wip|temp|tmp|test|testing|update[sd]?|changes?|fix(es)?|commit|save|asdf*|\.+|misc|stuff|minor)\s*\.?$/i;

export type CommitClass = { kind: ChangeKind; trivial: boolean; vague: boolean };

export function classifyCommit(message: string, parents = 1): CommitClass {
  const text = message.trim().split("\n")[0] ?? "";
  const vague = VAGUE.test(text) || text.length < 4;
  let kind: ChangeKind = "other";
  const m = text.match(CONVENTIONAL);
  if (parents > 1) kind = "merge";
  else if (m) kind = PREFIX[m[1].toLowerCase()] ?? "other";
  else kind = RULES.find(([, re]) => re.test(text))?.[0] ?? "other";
  // merges and housekeeping are real commits but not "changes someone made to the product"
  return { kind, trivial: kind === "merge" || kind === "chore", vague };
}

const LABEL: [RegExp, ChangeKind][] = [[/bug|fix|defect/i, "fix"], [/feat|enhancement|story/i, "feature"], [/refactor|tech.?debt|perf/i, "refactor"], [/doc/i, "docs"], [/test/i, "test"], [/chore|depend|ci\b|build/i, "chore"]];

// A pull request: its title first, then its labels and branch name when the title does not say.
export function classifyPr(title: string, labels: string[] = [], headRef = ""): ChangeKind {
  const fromTitle = classifyCommit(title).kind;
  if (fromTitle !== "other") return fromTitle;
  for (const l of labels) for (const [re, k] of LABEL) if (re.test(l)) return k;
  const b = headRef.match(BRANCH);
  return b ? (PREFIX[b[1].toLowerCase()] ?? "other") : "other";
}

// The changelog people write in the PR description: every bullet or ticked checkbox is one described change.
export function changelogItems(body: string | null | undefined): number {
  let n = 0;
  for (const line of (body ?? "").split("\n")) {
    if (/^\s*[-*+]\s+\[ \]/.test(line)) continue; // an unticked template checkbox, not a change
    if (/^\s*([-*+]|\d+[.)])\s+\S/.test(line)) n++;
  }
  return Math.min(n, 50);
}

// How far a change reached, from what it touched and what its author said it did. More than 100 files is almost
// always an import, a rename or generated output, so it is set apart ("bulk") and never counted as a big change.
export function scopeOf(files: number | null | undefined, items: number, commits = 1): Scope {
  if (files != null && files > 100) return "bulk";
  const byFiles = files == null ? 0 : files <= 3 ? 1 : files <= 15 ? 2 : 3;
  const byItems = items === 0 ? 0 : items <= 2 ? 1 : items <= 7 ? 2 : 3;
  const byCommits = commits >= 15 ? 3 : commits >= 5 ? 2 : 1;
  const level = Math.max(byFiles, byItems, byCommits === 3 ? 2 : 1); // many commits alone can make it medium, never large
  return level >= 3 ? "large" : level === 2 ? "medium" : "small";
}
