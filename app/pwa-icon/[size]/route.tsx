import { ImageResponse } from "next/og";

// App icons for the PWA / home screen, drawn at build time (no image files to maintain).
// "maskable" icons keep the artwork inside the central safe zone because phones crop them into circles/squircles.
const SIZES: Record<string, { px: number; maskable: boolean }> = {
  "192": { px: 192, maskable: false },
  "512": { px: 512, maskable: false },
  "maskable-512": { px: 512, maskable: true },
  "apple-180": { px: 180, maskable: true }, // iOS rounds the corners itself
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const spec = SIZES[size];
  if (!spec) return new Response("Not found", { status: 404 });

  const { px, maskable } = spec;
  const orb = Math.round(px * (maskable ? 0.5 : 0.62));

  return new ImageResponse(
    (
      <div
        style={{
          width: px,
          height: px,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#060a18",
          backgroundImage: "radial-gradient(circle at 25% 15%, rgba(95,80,255,0.55), rgba(6,10,24,0) 60%)",
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
            boxShadow: "0 0 60px rgba(139,123,255,0.55)",
          }}
        />
      </div>
    ),
    { width: px, height: px },
  );
}
