import { ImageResponse } from "next/og";
import { SPLASHES } from "@/lib/splash";
import { BRAND } from "@/lib/brand";

// iOS launch images, drawn at build time. Same look as the in-app splash (dark, glowing orb, name),
// so the hand-over from "launching" to "app" is seamless.
export function generateStaticParams() {
  return SPLASHES.map((s) => ({ size: `${s.w}x${s.h}` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const spec = SPLASHES.find((s) => `${s.w}x${s.h}` === size);
  if (!spec) return new Response("Not found", { status: 404 });

  const { w, h } = spec;
  const orb = Math.round(w * 0.3);

  return new ImageResponse(
    (
      <div
        style={{
          width: w,
          height: h,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#060a18",
          backgroundImage: "radial-gradient(circle at 50% 38%, rgba(95,80,255,0.38), rgba(6,10,24,0) 55%)",
        }}
      >
        <div
          style={{
            width: orb,
            height: orb,
            borderRadius: orb,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0) 22%), radial-gradient(circle at 70% 75%, #ff8fc4, rgba(255,143,196,0) 55%), radial-gradient(circle at 25% 72%, #34d6b0, rgba(52,214,176,0) 55%), radial-gradient(circle at 60% 30%, #8b7bff, #4a3fd1 75%)",
            boxShadow: `0 0 ${Math.round(orb * 0.5)}px rgba(139,123,255,0.55)`,
          }}
        />
        <div style={{ marginTop: Math.round(w * 0.1), fontSize: Math.round(w * 0.055), color: "#e8ecff", letterSpacing: 1, display: "flex" }}>{BRAND.name}</div>
        <div style={{ marginTop: Math.round(w * 0.02), fontSize: Math.round(w * 0.03), color: "#8b93b8", display: "flex" }}>Your work in one pulse.</div>
      </div>
    ),
    { width: w, height: h },
  );
}
