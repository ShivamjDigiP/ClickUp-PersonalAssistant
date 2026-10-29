"use client";
import { BRAND } from "@/lib/brand";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// Animated launch splash for the installed app (home-screen / standalone mode). It takes over from the iOS launch
// image with the same look, then fades into the app. It is skipped in a normal browser tab; add ?splash=1 to preview.
const MIN_MS = 1700; // long enough to read as a deliberate moment, short enough not to get in the way

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    new URLSearchParams(window.location.search).has("splash")
  );
}

export function Splash() {
  const wanted = useSyncExternalStore(
    () => () => {},
    isStandalone,
    () => false,
  );
  const reduce = useReducedMotion();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!wanted) return;
    if (new URLSearchParams(window.location.search).get("splash") === "hold") return; // preview mode: stay on screen
    const t = setTimeout(() => setDone(true), reduce ? 600 : MIN_MS);
    return () => clearTimeout(t);
  }, [wanted, reduce]);

  return (
    <AnimatePresence>
      {wanted && !done && (
        <motion.div
          key="splash"
          role="status"
          aria-label={`Loading ${BRAND.name}`}
          className="fixed fill-screen z-[100] flex flex-col items-center justify-center"
          style={{ background: "#060a18", backgroundImage: "radial-gradient(circle at 50% 38%, rgba(95,80,255,0.38), rgba(6,10,24,0) 55%)" }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <div className="relative grid place-items-center" style={{ width: 150, height: 150 }}>
            {!reduce &&
              [0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="absolute rounded-full border border-violet-300/40"
                  style={{ width: 120, height: 120 }}
                  initial={{ scale: 1, opacity: 0.55 }}
                  animate={{ scale: 2.4, opacity: 0 }}
                  transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
                />
              ))}
            <motion.div
              className="orb"
              style={{ width: 120, height: 120, animation: "none" }} /* no colour cycling: must match the launch image */
              initial={reduce ? false : { scale: 0.2, opacity: 0, rotate: -40 }}
              animate={reduce ? undefined : { scale: [0.2, 1.12, 1], opacity: 1, rotate: 0 }}
              transition={{ duration: 0.9, times: [0, 0.65, 1], ease: "easeOut" }}
            />
          </div>

          <motion.h1
            className="mt-9 text-2xl font-light tracking-wide text-[#e8ecff]"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.6 }}
          >
            {BRAND.name}
          </motion.h1>
          <motion.p
            className="mt-2 text-sm text-[#8b93b8]"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75, duration: 0.6 }}
          >
            Your work in one pulse.
          </motion.p>

          {/* thin progress line that fills while the app wakes up */}
          <div className="mt-10 h-[3px] w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg,#7df0d0,#a99bff,#ffd98a)" }}
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: (reduce ? 0.6 : MIN_MS / 1000) - 0.1, ease: "easeInOut" }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
