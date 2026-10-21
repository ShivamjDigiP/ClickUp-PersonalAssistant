import { ImageResponse } from "next/og";

// Browser-tab favicon: the same orb as the app icon.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", background: "#060a18", borderRadius: 14 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 42,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0) 24%), radial-gradient(circle at 60% 30%, #8b7bff, #4a3fd1 75%)",
          }}
        />
      </div>
    ),
    size,
  );
}
