"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Orb } from "./Orb";
import { PulseView } from "./PulseView";
import { ChatView } from "./ChatView";
import { ActivityView } from "./ActivityView";
import { MeView } from "./MeView";
import { CheckInDeck } from "./CheckInDeck";
import { ProjectPage, type Origin } from "./project/ProjectPage";
import { HEALTH_COLOR } from "@/lib/health";
import { ThemeMenu } from "./ThemeMenu";
import { ReadOnlyToggle } from "./ReadOnlyToggle";
import { useChat } from "./useChat";
import { BottomNav } from "./BottomNav";
import { THEME_SWITCHING, useThemePref } from "./useTheme";
import { useInstallPrompt } from "./usePwa";
import type { Project, PulseData } from "@/app/api/pulse/route";

const TABS = [
  { id: "pulse", label: "Pulse" },
  { id: "chat", label: "Chat" },
  { id: "me", label: "Me" },
  { id: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Shell() {
  const [tab, setTab] = useState<Tab>("pulse");
  const [readOnly, setReadOnly] = useState(true);
  const [name, setName] = useState("there");
  const [sweep, setSweep] = useState(0);
  const [checkIn, setCheckIn] = useState(false);
  const [selected, setSelected] = useState<{ project: Project; origin: Origin } | null>(null);
  const pushed = useRef(false); // did opening the project add a browser history entry?
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [themePref, setThemePref] = useThemePref();
  const [toast, setToast] = useState<{ id: number; text: string; tone: "info" | "warn" | "error" } | null>(null);
  const chat = useChat();
  const { canInstall, install } = useInstallPrompt();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setReadOnly(s.readOnly);
        if (s.name) setName(s.name);
      });
    // Loaded once and shared: Pulse draws it, Chat uses it for smart suggestions
    fetch("/api/pulse")
      .then((r) => r.json())
      .then((d) => (d.error ? setProjectsError(d.error) : setPulse(d)))
      .catch((e) => setProjectsError(e.message));
  }, []);

  // Dark-only while THEME_SWITCHING is off. When it is on: Auto = Read-only is light, Approval mode is dark; Light/Dark override it.
  const theme: "light" | "dark" = !THEME_SWITCHING ? "dark" : themePref === "auto" ? (readOnly ? "light" : "dark") : themePref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const notify = (text: string, tone: "info" | "warn" | "error" = "info") => {
    const id = Date.now();
    setToast({ id, text, tone });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3200);
  };

  // Two modes. Read-only: nothing can change. Approve & Act: the assistant may propose changes, each needs your approval.
  async function toggle() {
    const next = !readOnly;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readOnly: next }),
      });
      // read the body defensively: a server crash can return an empty or non-JSON body
      const s = await res.json().catch(() => ({}) as { readOnly?: boolean; error?: string });
      if (!res.ok || typeof s.readOnly !== "boolean") throw new Error(s.error ?? `The server could not save this (HTTP ${res.status}).`);
      setReadOnly(s.readOnly);
      if (s.readOnly) notify("Read-only is on. Nothing can be changed.");
      else {
        setSweep((n) => n + 1); // warm amber light sweeps across when changes are enabled
        notify("Approve & Act is on. The assistant can propose changes; each one needs your approval.", "warn");
      }
    } catch (e) {
      notify(`Couldn't switch mode: ${(e as Error).message}`, "error");
    }
  }

  // A project opens at its own address (/imported-from-jira). Back/forward and the close button stay in sync.
  const openProject = (project: Project, x: number, y: number) => {
    window.history.pushState({ project: project.id }, "", `/${project.slug}`);
    pushed.current = true;
    setSelected({ project, origin: { x, y } });
  };
  const closeProject = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back(); // the popstate handler below closes the page
    }
    setSelected(null);
  };
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname === "/") {
        pushed.current = false;
        setSelected(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const ask = (q: string) => {
    closeProject();
    setTab("chat");
    chat.send(q);
  };

  // Spotlight: glass surfaces light up where the pointer is
  const onPointerMove = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".glass");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const light = theme === "light";
  // Personal assistant: suggestions and answers focus on the projects I'm engaged in (all, if I have none)
  const mineProjects = pulse?.projects.filter((p) => p.mine) ?? [];
  const focusProjects = pulse ? (mineProjects.length ? mineProjects : pulse.projects.filter((p) => !p.partial)) : null;

  return (
    <div className="flex h-dvh flex-col" onPointerMove={onPointerMove}>
      {/* Desktop: three equal columns keep the tabs truly centred. Phone: brand left, controls right, tabs move to the bottom bar. */}
      <header
        className="flex items-center justify-between gap-3 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-8 md:grid md:grid-cols-[1fr_auto_1fr] md:pb-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Orb size={32} thinking={chat.busy} pulseKey={chat.pulseKey} />
          <span className="truncate text-sm font-medium max-[420px]:hidden md:max-lg:hidden">ClickUp Assistant</span>
        </div>

        <nav className="glass hidden gap-1 rounded-full p-1 text-sm md:flex" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className="relative rounded-full px-4 py-1.5 sm:px-5"
            >
              {tab === t.id && (
                <motion.span layoutId="tab" className="absolute inset-0 rounded-full bg-[rgb(var(--tint)/0.12)]" transition={{ type: "spring", stiffness: 380, damping: 30 }} />
              )}
              <span className={`relative ${tab === t.id ? "text-[var(--fg)]" : "text-[var(--muted)]"}`}>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <ReadOnlyToggle readOnly={readOnly} onToggle={toggle} />
          {THEME_SWITCHING && <ThemeMenu pref={themePref} effective={theme} onChange={setThemePref} />}
          {canInstall && (
            <button
              onClick={install}
              aria-label="Install app"
              title="Install ClickUp Assistant on this device"
              className="glass flex h-10 items-center gap-2 rounded-full px-3 text-xs"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
              </svg>
              <span className="hidden lg:inline">Install</span>
            </button>
          )}
          <button
            onClick={() => setTab("me")}
            aria-label="Open my profile"
            className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-slate-900"
            style={{ background: "linear-gradient(135deg,#7df0d0,#a99bff)" }}
            title={name}
          >
            {(name[0] ?? "U").toUpperCase()}
          </button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="h-full overflow-y-auto overflow-x-hidden"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
          >
            {tab === "pulse" && (
              <PulseView
                pulse={pulse}
                error={projectsError}
                onAsk={ask}
                onSelect={openProject}
                pulseKey={chat.pulseKey}
                thinking={chat.busy}
                light={light}
              />
            )}
            {tab === "chat" && <ChatView chat={chat} name={name} readOnly={readOnly} light={light} projects={focusProjects} onCheckIn={() => setCheckIn(true)} />}
            {tab === "me" && <MeView projects={pulse?.projects ?? null} onAsk={ask} onSelect={openProject} />}
            {tab === "activity" &&<ActivityView readOnly={light} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav tabs={TABS} tab={tab} onChange={setTab} />

      {/* Mode feedback: soft edge glow while read-only, amber sweep when writes turn on */}
      <div
        aria-hidden
        className={`pointer-events-none fixed fill-screen z-30 transition-opacity duration-500 ${readOnly ? "opacity-100" : "opacity-0"}`}
        style={{ boxShadow: "inset 0 0 90px rgba(130,150,255,.14)" }}
      />
      <AnimatePresence>
        {sweep > 0 && (
          <motion.div
            key={sweep}
            aria-hidden
            className="pointer-events-none fixed inset-y-0 z-50 w-1/2"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,181,71,.35), transparent)" }}
            initial={{ left: "-50%", opacity: 1 }}
            animate={{ left: "100%", opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
            onAnimationComplete={() => setSweep(0)}
          />
        )}
      </AnimatePresence>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              role="status"
              className="glass max-w-md px-5 py-3 text-center text-sm shadow-xl"
              style={{
                background: "var(--bg)",
                borderColor: toast.tone === "error" ? "var(--coral)" : toast.tone === "warn" ? "var(--amber)" : "var(--violet)",
              }}
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 26 }}
            >
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selected && (
          <ProjectPage
            key={selected.project.id}
            mode="overlay"
            id={selected.project.id}
            name={selected.project.name}
            color={selected.project.partial ? "#8b93b8" : HEALTH_COLOR[selected.project.health]}
            origin={selected.origin}
            onClose={closeProject}
            onAsk={ask}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{checkIn && <CheckInDeck readOnly={readOnly} onClose={() => setCheckIn(false)} />}</AnimatePresence>
    </div>
  );
}
