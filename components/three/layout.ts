// Pure layout math shared by the 3D scene and the HTML labels drawn over it,
// so a planet and its label always agree on where they are.
export const CAM_Z = 11;
export const FOV = 40;
export const LABEL_W = 140; // px reserved for a side label
const PLANET_MAX_PX = 44;

export type Layout = { rx: number; ry: number; ppu: number; orbR: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeLayout(width: number, height: number): Layout {
  const ppu = height / (2 * CAM_Z * Math.tan((FOV / 2) * (Math.PI / 180))); // pixels per world unit at z=0
  const rx = clamp((width / 2 - LABEL_W - 16 - PLANET_MAX_PX) / (ppu * 0.87), 1.5, 3.4);
  const orbMin = 0.9;
  // top/bottom planets carry a 2-line label (~44px) outside the planet, so reserve it
  const ryFit = (height / 2 - 56 - PLANET_MAX_PX) / ppu;
  const ry = clamp(Math.max(ryFit, orbMin + (PLANET_MAX_PX + 12) / ppu), 1.2, 2.6);
  const orbR = clamp(Math.min(1.55, rx * 0.55, ry - (PLANET_MAX_PX + 12) / ppu), orbMin, 1.55);
  return { rx, ry, ppu, orbR };
}

export type Side = "right" | "left" | "top" | "bottom";

export function planetSpec(totalTasks: number, index: number, n: number, layout: Layout) {
  const angle = (index / n) * Math.PI * 2 - Math.PI / 2;
  const cos = Math.cos(angle);
  const bx = cos * layout.rx;
  const by = -Math.sin(angle) * layout.ry; // screen-up is +y
  const rpx = 30 + Math.min(totalTasks, 40) * 0.35; // 30-44px; bigger = more tasks
  const side: Side = cos > 0.35 ? "right" : cos < -0.35 ? "left" : by > 0 ? "top" : "bottom";
  return { bx, by, rpx, radius: rpx / layout.ppu, side };
}
