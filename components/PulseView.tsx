"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Orb } from "./Orb";
import { OrbitStage } from "./OrbitStage";
import { useWebGL } from "./useWebGL";
import { HEALTH_COLOR, HEALTH_LABEL, byAttention } from "@/lib/health";
import type { Project, PulseData } from "@/app/api/pulse/route";

const MAX_PLANETS = 6; // like the design: a calm orbit, not a crowd. Every project is in the "all projects" list.

function Mountains() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-48 w-full opacity-60" viewBox="0 0 1200 240" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--violet)" stopOpacity=".26" />
          <stop offset="1" stopColor="var(--violet)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 240 L0 150 L90 120 L170 150 L260 92 L330 130 L420 170 L520 150 L640 205 L760 170 L900 190 L1020 160 L1200 200 L1200 240 Z" fill="url(#mtn)" />
      <path d="M0 240 L0 190 L120 170 L230 200 L360 175 L470 215 L600 200 L720 225 L1200 215 L1200 240 Z" fill="url(#mtn)" opacity=".7" />
    </svg>
  );
}

function Dot({ project, size = 36 }: { project: Project; size?: number }) {
  const c = project.partial ? "#8b93b8" : HEALTH_COLOR[project.health]; // grey until live health is loaded
  return (
    <span
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, #fffa, transparent 26%), radial-gradient(circle at 50% 60%, ${c}, ${c}66 92%)`,
        boxShadow: `0 0 20px ${c}77`,
      }}
    />
  );
}

type Scope = "mine" | "all";

export function PulseView({
  pulse,
  error,
  onAsk,
  onSelect,
  pulseKey,
  thinking,
  light,
}: {
  pulse: PulseData | null;
  error: string | null;
  onAsk: (q: string) => void;
  onSelect: (p: Project, x: number, y: number) => void;
  pulseKey: number;
  thinking: boolean;
  light: boolean;
}) {
  const reduce = useReducedMotion();
  const webgl = useWebGL();
  const [showAll, setShowAll] = useState(false);
  const [pop, setPop] = useState({ up: false, max: 288 });
  const [pick, setPick] = useState<Scope | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Default to the projects I'm engaged in; fall back to everything if I'm not engaged in any
  const scope: Scope = pick ?? (pulse && pulse.counts.mine > 0 ? "mine" : "all");
  const projects = pulse?.projects ?? null;

  // Close the project list on outside click or Escape
  useEffect(() => {
    if (!showAll) return;
    const away = (e: PointerEvent) => !trigger.current?.parentElement?.contains(e.target as Node) && setShowAll(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setShowAll(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [showAll]);

  // Open the list where there is room: upward if the button is low on screen, and never taller than the space
  const toggleAll = () => {
    if (!showAll && trigger.current) {
      const r = trigger.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 96; // keep clear of the bottom bar
      const above = r.top - 76; // keep clear of the header
      const up = below < 200 && above > below;
      setPop({ up, max: Math.max(140, Math.min(340, up ? above : below)) });
    }
    setShowAll((v) => !v);
  };

  const sorted = useMemo(() => byAttention((projects ?? []).filter((p) => scope === "all" || p.mine)), [projects, scope]);
  // Planets need live health, so only fully loaded projects get one; the orb and the list always show the true total
  const planets = sorted.filter((p) => !p.partial).slice(0, MAX_PLANETS);
  const mineScope = scope === "mine";

  // "Needs attention" is personal in My projects (your own overdue tasks) and project-wide in All projects
  const attention = mineScope ? (pulse?.my.overdue ?? 0) : sorted.reduce((n, p) => n + p.overdue, 0);
  const worst = sorted.find((p) => p.overdue > 0);
  const pill = !pulse
    ? { text: "Reading your workspace…", color: "var(--muted)", q: null }
    : attention > 0
      ? {
          text: mineScope ? `${attention} of your tasks ${attention === 1 ? "is" : "are"} overdue` : `${attention} overdue task${attention === 1 ? "" : "s"} across these projects`,
          color: "var(--amber)",
          q: mineScope ? "Which of my tasks are overdue and what should I do first?" : worst ? `What is overdue in ${worst.name}?` : "What needs my attention today?",
        }
      : { text: mineScope ? "All caught up. None of your tasks are overdue" : "All caught up. Nothing overdue", color: "var(--teal)", q: "Summarize my week so far" };

  // One plain sentence, all numbers consistent with the chips and the orb
  const note = !pulse
    ? ""
    : mineScope
      ? `${pulse.counts.mine} project${pulse.counts.mine === 1 ? "" : "s"} where you have tasks assigned. Health is for the whole project.`
      : `${pulse.counts.accessible} projects you can access, ${pulse.counts.mine} of them with your tasks.` +
        (sorted.length > planets.length ? ` The ${planets.length} needing most attention are shown; open the full list below.` : "");

  return (
    <div className="relative h-full overflow-y-auto md:overflow-hidden">
      <Mountains />
      <div className="relative mx-auto grid min-h-full max-w-7xl grid-cols-1 gap-4 px-4 pb-3 pt-2 sm:gap-8 sm:px-8 md:h-full md:grid-cols-[5fr_7fr] md:items-center md:pb-24 md:pt-6">
        <div>
          <h2 className="text-4xl font-extralight leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Your work
            <br />
            in one pulse.
          </h2>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
            Projects, progress and blockers at a glance. Always in sync with ClickUp.
          </p>

          {pulse && pulse.counts.mine > 0 && (
            <div className="mt-4 inline-flex gap-1 sm:mt-7 rounded-full border border-[var(--glass-border)] bg-[var(--glass)] p-1 text-sm" role="group" aria-label="Which projects to show">
              {(
                [
                  { id: "mine", label: "My projects", n: pulse.counts.mine },
                  { id: "all", label: "All accessible", n: pulse.counts.accessible },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  aria-pressed={scope === o.id}
                  onClick={() => {
                    setPick(o.id);
                    setShowAll(false);
                  }}
                  className={`relative rounded-full px-4 py-1.5 transition-colors ${scope === o.id ? "text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
                >
                  {scope === o.id && <motion.span layoutId="scope" className="absolute inset-0 rounded-full bg-[rgb(var(--tint)/0.12)]" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                  <span className="relative">
                    {o.label} <span className="text-xs opacity-70">{o.n}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {pulse && (
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-[var(--muted)]">{note}</p>
          )}

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--muted)]" aria-label="Legend">
            {(Object.keys(HEALTH_COLOR) as (keyof typeof HEALTH_COLOR)[]).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_COLOR[k] }} />
                {HEALTH_LABEL[k]}
              </li>
            ))}
          </ul>

          {sorted.length > planets.length && (
            <div className="relative mt-6">
              <button ref={trigger} className="chip" aria-pressed={showAll} aria-expanded={showAll} onClick={toggleAll}>
                {showAll ? "Hide" : `All ${sorted.length} projects`}
              </button>
              <AnimatePresence>
                {showAll && (
                  <motion.ul
                    className={`glass scroll-fade absolute left-0 z-20 w-72 overflow-y-auto p-2 ${pop.up ? "bottom-11" : "top-11"}`}
                    style={{ maxHeight: pop.max, background: "var(--bg)" }}
                    initial={{ opacity: 0, y: pop.up ? 6 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: pop.up ? 6 : -6 }}
                  >
                    {sorted.map((p) => (
                      <li key={p.id}>
                        <button
                          onClick={(e) => {
                            setShowAll(false);
                            onSelect(p, e.clientX, e.clientY);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-[rgb(var(--tint)/0.07)]"
                        >
                          <Dot project={p} size={14} />
                          <span className="flex-1 truncate">{p.name}</span>
                          <span className="text-xs" style={{ color: p.partial ? "var(--muted)" : HEALTH_COLOR[p.health] }}>
                            {p.partial ? `${p.total} tasks` : `${p.progress}%`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="min-w-0">
          {error ? (
            <p className="glass p-5 text-sm text-[var(--coral)]">Couldn’t load projects: {error}</p>
          ) : !projects ? (
            <div className="grid place-items-center py-16 md:h-[min(76vh,640px)]">
              <Orb size={150} thinking three light={light} />
            </div>
          ) : sorted.length === 0 ? (
            <p className="glass p-5 text-sm text-[var(--muted)]">No projects to show yet. Once you have tasks assigned, they appear here.</p>
          ) : (
            <>
              {webgl && (
                <div className="relative hidden h-[min(76vh,640px)] min-h-[420px] md:block">
                  <OrbitStage
                    projects={planets}
                    total={sorted.length}
                    caption={mineScope ? "My project" : "Project"}
                    onSelect={onSelect}
                    thinking={thinking}
                    pulseKey={pulseKey}
                    light={light}
                    still={!!reduce}
                  />
                </div>
              )}

              {/* Phones, or no WebGL: a clean ranked list */}
              <ul className={`space-y-3 ${webgl ? "md:hidden" : ""}`}>
                {sorted.map((p, i) => (
                  <motion.li key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    <button onClick={(e) => onSelect(p, e.clientX, e.clientY)} className="glass flex w-full items-center gap-4 p-4 text-left">
                      <Dot project={p} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block text-xs" style={{ color: p.partial ? "var(--muted)" : HEALTH_COLOR[p.health] }}>
                          {p.partial ? `${p.total} tasks · tap for details` : `${p.progress}% · ${HEALTH_LABEL[p.health]}`}
                        </span>
                      </span>
                      <span className="text-[var(--muted)]">›</span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Phone: sits at the end of the page. Desktop: floats at the bottom of the screen. */}
      <div className="relative z-10 flex items-end justify-between gap-4 px-4 pb-6 pt-2 sm:px-8 md:pointer-events-none md:absolute md:inset-x-8 md:bottom-5 md:p-0">
        <p className="hidden max-w-[11rem] text-xs leading-relaxed text-[var(--muted)] md:block">Calmly moving your work forward.</p>
        <button
          disabled={!pill.q}
          onClick={() => pill.q && onAsk(pill.q)}
          className="glass pointer-events-auto flex w-full items-center justify-center gap-3 rounded-full px-5 py-3 text-sm md:ml-auto md:w-auto"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: pill.color }} />
          {pill.text}
          {pill.q && <span className="text-[var(--muted)]">›</span>}
        </button>
      </div>
    </div>
  );
}
