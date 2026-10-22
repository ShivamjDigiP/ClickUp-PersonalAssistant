import { describe, expect, it } from "vitest";
import { buildPrompt, parseAiReply } from "../lib/sync/ai";
import { applyAiMatches, reconcile } from "../lib/sync/match";
import type { SyncPr, SyncTask } from "../lib/sync/types";

const task = (over: Partial<SyncTask>): SyncTask => ({ id: "t1", name: "Task", status: "in progress", done: false, backlog: false, url: "u", list: "L", listId: "l1", updated: "2026-10-20", ...over });
const pr = (over: Partial<SyncPr>): SyncPr => ({ repo: "acme/app", number: 1, title: "A PR", state: "open", url: "u", updated: "2026-10-20", draft: false, taskIds: [], ...over });
const want = (_t: SyncTask, s: "open" | "merged") => (s === "merged" ? "complete" : "in progress");

const tasks = new Map([["t9", task({ id: "t9", name: "Habits created without image", status: "in review" })]]);
const base = () => reconcile({ prs: [pr({ number: 5, state: "merged", title: "Fix habit image upload" })], mine: [...tasks.values()], referenced: new Map(tasks), windowStart: "2026-10-01", wantedStatus: want }).items;

describe("AI matching", () => {
  it("a confident match becomes a linked PR and shows the status mismatch with its reason", () => {
    const out = applyAiMatches(base(), [{ pr: "acme/app#5", task: "t9", confidence: 0.86, reason: "changelog: habit image upload" }], tasks, want);
    expect(out.matched).toBe(1);
    expect(out.items).toMatchObject([{ kind: "status", want: "complete", ai: { confidence: 0.86 } }]);
  });

  it("stops reporting the matched task as 'task without PR'", () => {
    const items = base();
    expect(items.some((i) => i.kind === "task_no_pr")).toBe(true);
    const out = applyAiMatches(items, [{ pr: "acme/app#5", task: "t9", confidence: 0.9, reason: "x" }], tasks, want);
    expect(out.items.some((i) => i.kind === "task_no_pr")).toBe(false);
  });

  it("counts an AI match whose task is already in the right status as in sync", () => {
    const done = new Map([["t9", task({ id: "t9", status: "complete", done: true })]]);
    const items = reconcile({ prs: [pr({ number: 5, state: "merged" })], mine: [...done.values()], referenced: new Map(), windowStart: "2026-10-01", wantedStatus: want }).items;
    const out = applyAiMatches(items, [{ pr: "acme/app#5", task: "t9", confidence: 0.9, reason: "x" }], done, want);
    expect(out).toMatchObject({ matched: 1, inSync: 1 });
    expect(out.items.filter((i) => i.kind === "status")).toEqual([]);
  });

  it("keeps an unsure match as a suggestion only", () => {
    const out = applyAiMatches(base(), [{ pr: "acme/app#5", task: "t9", confidence: 0.4, reason: "maybe" }], tasks, want);
    expect(out.matched).toBe(0);
    expect(out.items.find((i) => i.kind === "pr_no_task")).toMatchObject({ guess: { ai: true, score: 0.4 } });
  });

  it("ignores a task id the model made up", () => {
    expect(applyAiMatches(base(), [{ pr: "acme/app#5", task: "nope", confidence: 0.95, reason: "x" }], tasks, want).matched).toBe(0);
  });

  it("reads the reply as bare, fenced or wrapped JSON", () => {
    const json = '{"summary":"s","matches":[{"pr":"a#1","task":null,"confidence":0.2,"reason":"r"}]}';
    expect(parseAiReply(json).matches).toHaveLength(1);
    expect(parseAiReply("```json\n" + json + "\n```").summary).toBe("s");
    expect(parseAiReply(JSON.stringify({ text: json })).matches[0].pr).toBe("a#1");
    expect(() => parseAiReply("sorry, no")).toThrow();
  });

  it("puts the changelog and the candidate tasks in the prompt", () => {
    const p = buildPrompt([{ key: "a#1", title: "T", state: "merged", text: "Fixed image upload", source: "changelog" }], [{ id: "t9", name: "Habits", status: "open", list: "L", desc: "" }], []);
    expect(p).toContain("(changelog) Fixed image upload");
    expect(p).toContain("t9 | Habits");
  });
});
