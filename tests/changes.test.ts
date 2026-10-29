import { describe, expect, it } from "vitest";
import { changelogItems, classifyCommit, classifyPr, scopeOf } from "../lib/analytics/changes";

describe("classifyCommit", () => {
  it.each([
    ["feat(auth): add SSO login", "feature"],
    ["fix: crash when the list is empty", "fix"],
    ["Fixed the user session check", "fix"],
    ["Added course content step", "feature"],
    ["refactor: split the chart component", "refactor"],
    ["Cleanup unused imports", "refactor"],
    ["Updated README", "docs"],
    ["add tests for the invite flow", "test"],
    ["Bump axios from 1.6 to 1.7", "chore"],
    ["update package-lock.json", "chore"],
    ["Merge branch 'develop' into dev-shivam-v9", "merge"],
    ["Revert \"Add SSO login\"", "revert"],
    ["Habits : content", "other"],
  ] as const)("%s -> %s", (msg, kind) => {
    expect(classifyCommit(msg).kind).toBe(kind);
  });

  it("treats merges and housekeeping as trivial, real changes as meaningful", () => {
    expect(classifyCommit("Merge branch 'x'").trivial).toBe(true);
    expect(classifyCommit("Bump lodash").trivial).toBe(true);
    expect(classifyCommit("feat: new report").trivial).toBe(false);
    expect(classifyCommit("fix: login redirect").trivial).toBe(false);
  });

  it("a commit with two parents is a merge whatever it says", () => {
    expect(classifyCommit("Add reports", 2)).toMatchObject({ kind: "merge", trivial: true });
  });

  it("flags messages that say nothing", () => {
    for (const m of ["wip", "update", "fix", "temp", ".", "asdf"]) expect(classifyCommit(m).vague).toBe(true);
    expect(classifyCommit("fix: payment rounding").vague).toBe(false);
  });
});

describe("classifyPr", () => {
  it("uses the title, then labels, then the branch name", () => {
    expect(classifyPr("fix: broken invite email")).toBe("fix");
    expect(classifyPr("Habits : content", ["enhancement"])).toBe("feature");
    expect(classifyPr("Habits : content", [], "hotfix/habits")).toBe("fix");
    expect(classifyPr("Habits : content", [], "dev-shivam-v10")).toBe("other");
  });
});

describe("changelogItems", () => {
  it("counts described changes, not template boxes that were left unticked", () => {
    const body = "## Changelog\n- Added invite email\n- Fixed expiry check\n* Updated copy\n1. Moved settings\n\n## Checklist\n- [x] tested locally\n- [ ] updated docs\n- [ ] added tests";
    expect(changelogItems(body)).toBe(5);
    expect(changelogItems("")).toBe(0);
    expect(changelogItems(null)).toBe(0);
  });
});

describe("scopeOf", () => {
  it("uses files touched and changelog items, and sets imports apart instead of calling them big", () => {
    expect(scopeOf(2, 1, 1)).toBe("small");
    expect(scopeOf(8, 3, 2)).toBe("medium");
    expect(scopeOf(30, 2, 3)).toBe("large");
    expect(scopeOf(5, 12, 3)).toBe("large"); // a long changelog counts even when few files changed
    expect(scopeOf(4000, 0, 2)).toBe("bulk");
  });

  it("falls back on the changelog and commit count when files are unknown", () => {
    expect(scopeOf(null, 0, 1)).toBe("small");
    expect(scopeOf(null, 5, 1)).toBe("medium");
    expect(scopeOf(null, 0, 20)).toBe("medium"); // many commits alone is at most medium
  });
});
