"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Chrome/Edge/Android fire `beforeinstallprompt` when the app can be installed. We keep the event
// and let a button trigger it. (iOS has no such event: use Share > Add to Home Screen.)
export function useInstallPrompt() {
  const saved = useRef<InstallEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      saved.current = e as InstallEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      saved.current = null;
      setCanInstall(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const ev = saved.current;
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice;
    saved.current = null;
    setCanInstall(false);
  }, []);

  return { canInstall, install };
}
