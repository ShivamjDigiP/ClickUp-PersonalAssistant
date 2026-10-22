import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegister } from "@/components/PwaRegister";
import { Splash } from "@/components/Splash";
import { SPLASHES, splashHref, splashMedia } from "@/lib/splash";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClickUp Assistant",
  description: "Your ClickUp work in one pulse.",
  applicationName: "ClickUp Assistant",
  // iOS: lets "Add to Home Screen" open it full-screen like an app, with a launch image instead of a blank screen.
  // "black" (solid) not "black-translucent": with the see-through style, iOS 18 draws the page from the very top but makes it
  // exactly one status-bar-height too short (measured on an iPhone 16 Pro: 812px of 874px), leaving a dead strip at the bottom.
  appleWebApp: {
    capable: true,
    title: "ClickUp AI",
    statusBarStyle: "black",
    startupImage: SPLASHES.map((s) => ({ url: splashHref(s), media: splashMedia(s) })),
  },
  icons: { apple: "/pwa-icon/apple-180" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // draw under the notch; the app pads with safe-area insets
  themeColor: "#060a18",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
        <Splash />
        <PwaRegister />
      </body>
    </html>
  );
}
