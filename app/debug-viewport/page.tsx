import type { Metadata } from "next";
import { ViewportProbe } from "./ViewportProbe";

// A tiny diagnostic page: open it inside the installed app and screenshot it so screen-size problems on a
// specific phone can be seen as numbers instead of guessed at.
export const metadata: Metadata = { title: "Viewport check", robots: { index: false, follow: false } };

export default function DebugViewport() {
  return <ViewportProbe />;
}
