"use client";

import { useEffect, useMemo, useState } from "react";
import { RepoPicker } from "./RepoPicker";
import type { PrOption, TaskOption } from "@/lib/pr-comments/candidates";

const DAY_OPTIONS = [14, 30, 60] as const;
const PREFS_KEY = "clickup-assistant:pr-comment-prefs";
const MAX_PRS = 8;
const SHOWN_TASKS = 8;

type Step = "task" | "repos" | "prs";
type Prefs = { repos: string[]; days: number };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (p && Array.isArray(p.repos)) return { repos: p.repos.filter((r: unknown) => typeof r === "string"), days: DAY_OPTIONS.includes(p.days) ? p.days : 30 };
  } catch {}
  return { repos: [], days: 30 };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error ?? `Request failed (HTTP ${res.status}).`);
  return body as T;
}

type Props = { onClose: () => void; onDraft: (task: TaskOption, prs: { repo: string; number: number }[]) => void };

// Three steps: pick ONE ClickUp task, pick repositories, tick the PRs that belong to that task. Then one short comment is drafted.
export function PrCommentDialog({ onClose, onDraft }: Props) {
  const [prefs] = useState(loadPrefs);
  const [step, setStep] = useState<Step>("task");
  const [tasks, setTasks] = useState<TaskOption[] | null>(null);
  const [task, setTask] = useState<TaskOption | null>(null);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<string[]>(prefs.repos);
  const [days, setDays] = useState<number>(prefs.days);
  const [prs, setPrs] = useState<PrOption[] | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    getJson<{ tasks: TaskOption[] }>("/api/pr-comments/tasks")
      .then((d) => setTasks(d.tasks))
      .catch((e: Error) => {
        setTasks([]);
        setProblem(e.message);
      });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = tasks ?? [];
    return (q ? all.filter((t) => `${t.name} ${t.list} ${t.id}`.toLowerCase().includes(q)) : all).slice(0, SHOWN_TASKS);
  }, [tasks, query]);

  async function pasteTask() {
    setWorking(true);
    setProblem(null);
    try {
      const { task: found } = await getJson<{ task: TaskOption }>(`/api/pr-comments/tasks?link=${encodeURIComponent(paste)}`);
      setTask(found);
      setPaste("");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function findPrs() {
    if (!task) return;
    setWorking(true);
    setProblem(null);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ repos, days }));
    } catch {}
    try {
      const { prs: found } = await getJson<{ prs: PrOption[] }>(`/api/pr-comments?repos=${encodeURIComponent(repos.join(","))}&days=${days}&task=${task.id}`);
      setPrs(found);
      setTicked(found.filter((p) => p.linked).map((p) => p.key).slice(0, MAX_PRS)); // PRs that name this task start ticked
      setStep("prs");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function pastePr() {
    if (!task) return;
    setWorking(true);
    setProblem(null);
    try {
      const { pr } = await getJson<{ pr: PrOption }>(`/api/pr-comments/lookup?link=${encodeURIComponent(paste)}&task=${task.id}`);
      setPrs((list) => (list?.some((p) => p.key === pr.key) ? list : [pr, ...(list ?? [])]));
      setTicked((t) => (t.includes(pr.key) || t.length >= MAX_PRS ? t : [...t, pr.key]));
      setPaste("");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const toggle = (key: string) => setTicked((t) => (t.includes(key) ? t.filter((k) => k !== key) : t.length < MAX_PRS ? [...t, key] : t));

  function draft() {
    if (!task || !prs) return;
    onDraft(task, prs.filter((p) => ticked.includes(p.key)).map((p) => ({ repo: p.repo, number: p.number })));
    onClose();
  }

  const heading = { task: "1. Choose the ClickUp task", repos: "2. Where are the PRs?", prs: "3. Tick the PRs for this task" }[step];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prc-title"
        className="glass flex max-h-[90vh] w-full max-w-md flex-col rounded-3xl p-5"
        style={{ background: "var(--bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="prc-title" className="text-xl font-light">
          Comment from PRs
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">{heading}. I will write one short comment on the task: what changed and how it helps.</p>

        {task && step !== "task" && (
          <p className="mt-3 truncate rounded-xl bg-[rgb(var(--tint)/0.08)] px-3 py-2 text-xs">
            Task: <b className="font-medium">{task.name}</b> <span className="text-[var(--muted)]">· {task.status}</span>
          </p>
        )}

        {step === "task" && (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tasks ? `Search ${tasks.length} of your tasks` : "Loading your tasks…"}
              aria-label="Search tasks"
              className="rounded-full border border-[var(--glass-border)] bg-transparent px-4 py-2 text-xs outline-none focus:border-[var(--violet)]"
            />
            <ul className="mt-3 min-h-24 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Tasks" aria-busy={!tasks}>
              {matches.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setTask(t)}
                    aria-pressed={task?.id === t.id}
                    className={`w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-[rgb(var(--tint)/0.08)] ${task?.id === t.id ? "bg-[rgb(var(--tint)/0.14)]" : ""}`}
                  >
                    <span className="block truncate">{t.name}</span>
                    <span className="block truncate text-[10px] text-[var(--muted)]">
                      {t.status} · {t.list}
                    </span>
                  </button>
                </li>
              ))}
              {tasks && !matches.length && <li className="px-3 py-3 text-xs text-[var(--muted)]">{query ? "No task matches. Paste its link below." : "No tasks found."}</li>}
            </ul>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                pasteTask();
              }}
            >
              <input
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="Not listed? Paste the ClickUp task link"
                aria-label="ClickUp task link"
                className="min-w-0 flex-1 rounded-full border border-[var(--glass-border)] bg-transparent px-3 py-1.5 text-xs outline-none focus:border-[var(--violet)]"
              />
              <button type="submit" className="chip" disabled={working || !paste.trim()}>
                Use
              </button>
            </form>
          </div>
        )}

        {step === "repos" && (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <RepoPicker selected={repos} onChange={setRepos} />
            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Time range">
              <span className="text-xs text-[var(--muted)]">PRs from the last</span>
              {DAY_OPTIONS.map((d) => (
                <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d} days
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "prs" && prs && (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <ul className="min-h-24 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Pull requests">
              {prs.map((p) => (
                <li key={p.key}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 text-xs hover:bg-[rgb(var(--tint)/0.08)]">
                    <input type="checkbox" checked={ticked.includes(p.key)} onChange={() => toggle(p.key)} className="mt-0.5 accent-[var(--violet)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.title}</span>
                      <span className="block truncate text-[10px] text-[var(--muted)]">
                        {p.repo.split("/")[1]}#{p.number} · {p.state}
                        {p.linked && <span className="text-[var(--teal)]"> · names this task</span>}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {!prs.length && <li className="px-3 py-3 text-xs text-[var(--muted)]">No PRs of yours in those repositories for this period. Paste a PR link below, or go back and widen the days.</li>}
            </ul>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                pastePr();
              }}
            >
              <input
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="Another PR? Paste its GitHub link"
                aria-label="GitHub PR link"
                className="min-w-0 flex-1 rounded-full border border-[var(--glass-border)] bg-transparent px-3 py-1.5 text-xs outline-none focus:border-[var(--violet)]"
              />
              <button type="submit" className="chip" disabled={working || !paste.trim()}>
                Add
              </button>
            </form>
            <p className="mt-2 text-[11px] text-[var(--muted)]">{ticked.length ? `${ticked.length} selected (up to ${MAX_PRS}).` : "Tick the PRs that belong to this task."}</p>
          </div>
        )}

        {problem && (
          <p role="alert" className="mt-2 text-[11px] text-[var(--coral)]">
            {problem}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {step !== "task" && (
            <button className="chip" onClick={() => setStep(step === "prs" ? "repos" : "task")}>
              Back
            </button>
          )}
          <button className="chip" onClick={onClose}>
            Cancel
          </button>
          {step === "task" && (
            <button className="chip" style={{ background: "rgb(var(--tint) / 0.18)" }} disabled={!task} onClick={() => setStep("repos")}>
              Next
            </button>
          )}
          {step === "repos" && (
            <button className="chip" style={{ background: "rgb(var(--tint) / 0.18)" }} disabled={working} onClick={findPrs}>
              {working ? "Finding…" : repos.length ? "Find PRs" : "Find PRs in all repos"}
            </button>
          )}
          {step === "prs" && (
            <button className="chip" style={{ background: "rgb(var(--tint) / 0.18)" }} disabled={!ticked.length} onClick={draft}>
              Write comment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
