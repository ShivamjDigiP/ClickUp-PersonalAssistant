"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Orb } from "./Orb";
import { PulseView } from "./PulseView";
import { ChatView } from "./ChatView";
import { ActivityView } from "./ActivityView";
import { MeView } from "./MeView";
import { ConnectionsView } from "./ConnectionsView";
import { CheckInDeck } from "./CheckInDeck";
import { ProjectPage, type Origin } from "./project/ProjectPage";
import { HEALTH_COLOR } from "@/lib/health";
import { ThemeMenu } from "./ThemeMenu";
import { useChat } from "./useChat";
import { BottomNav } from "./BottomNav";
import { THEME_SWITCHING, useThemePref } from "./useTheme";
import { useInstallPrompt } from "./usePwa";
import type { Project, PulseData } from "@/app/api/pulse/route";

const TABS = [
  { id: "pulse", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "me", label: "Me" },
  { id: "activity", label: "Activity" },
  { id: "connections", label: "Configs" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Shell() {
  const [tab, setTab] = useState<Tab>("pulse");
  const [name, setName] = useState("there");
  const [checkIn, setCheckIn] = useState(false);
  const [selected, setSelected] = useState<{ project: Project; origin: Origin } | null>(null);
  const pushed = useRef(false); // did opening the project add a browser history entry?
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [themePref, setThemePref] = useThemePref();
  const chat = useChat();
  const { canInstall, install } = useInstallPrompt();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (s.name) setName(s.name);
      });
    // Loaded once and shared: Pulse draws it, Chat uses it for smart suggestions
    fetch("/api/pulse")
      .then((r) => r.json())
      .then((d) => (d.error ? setProjectsError(d.error) : setPulse(d)))
      .catch((e) => setProjectsError(e.message));
  }, []);

  // A tapped notification opens the app straight on a tab, e.g. /?tab=me
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (!t || !TABS.some((x) => x.id === t)) return;
    const id = setTimeout(() => setTab(t as Tab), 0);
    return () => clearTimeout(id);
  }, []);

  // Dark-only while THEME_SWITCHING is off. When it is on: Auto is dark; Light/Dark override it.
  const theme: "light" | "dark" = !THEME_SWITCHING ? "dark" : themePref === "auto" ? "dark" : themePref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
            {tab === "chat" && <ChatView chat={chat} name={name} light={light} projects={focusProjects} onCheckIn={() => setCheckIn(true)} />}
            {tab === "me" && <MeView projects={pulse?.projects ?? null} onAsk={ask} onSelect={openProject} />}
            {tab === "activity" &&<ActivityView light={light} />}
            {tab === "connections" && <ConnectionsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav tabs={TABS} tab={tab} onChange={setTab} />

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
      <AnimatePresence>{checkIn && <CheckInDeck onClose={() => setCheckIn(false)} />}</AnimatePresence>
    </div>
  );
}
