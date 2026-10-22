// iPhone launch screens. iOS shows one of these (matched by screen size and pixel ratio) while the home-screen app
// starts, instead of a blank white screen. Sizes are physical pixels (width x height).
export type SplashSpec = { w: number; h: number; dpr: 2 | 3; cssW: number; cssH: number };

export const SPLASHES: SplashSpec[] = [
  { w: 1320, h: 2868, dpr: 3, cssW: 440, cssH: 956 }, // iPhone 16 Pro Max
  { w: 1206, h: 2622, dpr: 3, cssW: 402, cssH: 874 }, // iPhone 16 Pro
  { w: 1290, h: 2796, dpr: 3, cssW: 430, cssH: 932 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { w: 1179, h: 2556, dpr: 3, cssW: 393, cssH: 852 }, // 14 Pro, 15, 15 Pro, 16
  { w: 1284, h: 2778, dpr: 3, cssW: 428, cssH: 926 }, // 12/13 Pro Max, 14 Plus
  { w: 1170, h: 2532, dpr: 3, cssW: 390, cssH: 844 }, // 12, 13, 14
  { w: 1125, h: 2436, dpr: 3, cssW: 375, cssH: 812 }, // X, XS, 11 Pro, 12/13 mini
  { w: 1242, h: 2688, dpr: 3, cssW: 414, cssH: 896 }, // XS Max, 11 Pro Max
  { w: 828, h: 1792, dpr: 2, cssW: 414, cssH: 896 }, // XR, 11
  { w: 750, h: 1334, dpr: 2, cssW: 375, cssH: 667 }, // SE, 8
];

export const splashHref = (s: SplashSpec) => `/pwa-splash/${s.w}x${s.h}`;
export const splashMedia = (s: SplashSpec) =>
  `(device-width: ${s.cssW}px) and (device-height: ${s.cssH}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`;
