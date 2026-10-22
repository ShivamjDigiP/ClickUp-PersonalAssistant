"use client";

import { useEffect, useRef, useState } from "react";

type Row = [string, string];

export function ViewportProbe() {
  const probe = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const measure = () => {
      const el = probe.current;
      if (!el) return;
      const q = (cls: string) => el.querySelector<HTMLElement>(cls)!.getBoundingClientRect();
      const inset = (side: string) => parseFloat(getComputedStyle(el.querySelector<HTMLElement>(`.in-${side}`)!).paddingTop) || 0;
      const vv = window.visualViewport;
      setRows([
        ["standalone (CSS)", String(window.matchMedia("(display-mode: standalone)").matches)],
        ["standalone (iOS)", String((navigator as unknown as { standalone?: boolean }).standalone)],
        ["window.inner W x H", `${window.innerWidth} x ${window.innerHeight}`],
        ["visualViewport W x H", vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)}` : "n/a"],
        ["screen W x H", `${screen.width} x ${screen.height}`],
        ["100vh", `${q(".h-vh").height}`],
        ["100dvh", `${q(".h-dvh").height}`],
        ["100svh", `${q(".h-svh").height}`],
        ["100lvh", `${q(".h-lvh").height}`],
        ["safe-area top", `${inset("top")}`],
        ["safe-area bottom", `${inset("bottom")}`],
        ["pixel ratio", String(window.devicePixelRatio)],
        ["user agent", navigator.userAgent.slice(0, 70)],
      ]);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <main className="px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-sm">
      <h1 className="mb-1 text-xl font-light">Viewport check</h1>
      <p className="mb-4 text-xs text-[var(--muted)]">Screenshot this page and send it over.</p>
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-white/10 pb-2">
            <dt className="text-[var(--muted)]">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {/* invisible probes that measure the CSS units */}
      <div ref={probe} aria-hidden className="pointer-events-none fixed left-0 top-0 opacity-0">
        <div className="h-vh" style={{ height: "100vh", width: 1 }} />
        <div className="h-dvh" style={{ height: "100dvh", width: 1 }} />
        <div className="h-svh" style={{ height: "100svh", width: 1 }} />
        <div className="h-lvh" style={{ height: "100lvh", width: 1 }} />
        <div className="in-top" style={{ paddingTop: "env(safe-area-inset-top)" }} />
        <div className="in-bottom" style={{ paddingTop: "env(safe-area-inset-bottom)" }} />
      </div>
    </main>
  );
}
