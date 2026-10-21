"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { computeLayout, LABEL_W, planetSpec, type Side } from "./three/layout";
import { HEALTH_COLOR, HEALTH_LABEL, shortName } from "@/lib/health";
import type { Project } from "@/app/api/pulse/route";

const PulseScene = dynamic(() => import("./three/PulseScene"), { ssr: false });

const place = (side: Side, r: number): React.CSSProperties => {
  switch (side) {
    case "right":
      return { transform: `translate(${r + 10}px, -50%)`, textAlign: "left" };
    case "left":
      return { transform: `translate(calc(-100% - ${r + 10}px), -50%)`, textAlign: "right" };
    case "top":
      return { transform: `translate(-50%, calc(-100% - ${r + 8}px))`, textAlign: "center" };
    case "bottom":
      return { transform: `translate(-50%, ${r + 8}px)`, textAlign: "center" };
  }
};

// 3D scene + HTML labels. Labels are real buttons (focusable, readable by screen readers)
// positioned with the same layout maths the scene uses.
export function OrbitStage({
  projects,
  total,
  caption,
  onSelect,
  thinking,
  pulseKey,
  light,
  still,
}: {
  projects: Project[];
  total: number; // all projects in this view, shown in the orb
  caption: string; // singular noun under the number, e.g. "My project"
  onSelect: (p: Project, x: number, y: number) => void;
  thinking: boolean;
  pulseKey: number;
  light: boolean;
  still: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => (size.w ? computeLayout(size.w, size.h) : null), [size]);

  return (
    <div ref={box} className="relative h-full w-full">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(closest-side at 50% 50%, rgb(139 123 255 / 0.2), transparent 75%)" }}
      />
      <PulseScene
        projects={projects}
        onSelect={onSelect}
        thinking={thinking}
        pulseKey={pulseKey}
        light={light}
        still={still}
        hoveredId={hoveredId}
        onHover={setHoveredId}
      />

      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white"
        style={{ textShadow: "0 1px 14px rgb(40 30 120 / 0.55)" }}
      >
        <div className="text-5xl font-light leading-none">{total}</div>
        <div className="mt-1 text-sm">
          {caption}
          {total === 1 ? "" : "s"}
        </div>
      </div>

      {layout &&
        projects.map((p, i) => {
          const s = planetSpec(p.total, i, projects.length, layout);
          const color = HEALTH_COLOR[p.health];
          const justify = s.side === "right" ? "flex-start" : s.side === "left" ? "flex-end" : "center";
          return (
            <button
              key={p.id}
              onClick={(e) => onSelect(p, e.clientX || e.currentTarget.getBoundingClientRect().x, e.clientY || e.currentTarget.getBoundingClientRect().y)}
              onPointerEnter={() => setHoveredId(p.id)}
              onPointerLeave={() => setHoveredId(null)}
              title={`${p.name} · ${p.progress}% · ${HEALTH_LABEL[p.health]}`}
              className="absolute select-none whitespace-nowrap rounded-md outline-offset-4 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--violet)]"
              style={{
                left: size.w / 2 + s.bx * layout.ppu,
                top: size.h / 2 - s.by * layout.ppu,
                width: LABEL_W,
                ...place(s.side, s.rpx),
              }}
            >
              <span className="block truncate text-[13px] font-medium leading-tight text-[var(--fg)]">{shortName(p.name, 20)}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight" style={{ color, justifyContent: justify }}>
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                {p.progress}% · {HEALTH_LABEL[p.health]}
              </span>
            </button>
          );
        })}
    </div>
  );
}
