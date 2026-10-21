"use client";

import { Canvas } from "@react-three/fiber";
import { OrbMesh } from "./OrbMesh";

// Stand-alone 3D orb (chat greeting). Pulse uses the same OrbMesh inside its own scene.
export default function Orb3D({
  size,
  thinking,
  pulseKey,
  light,
}: {
  size: number;
  thinking: boolean;
  pulseKey: number;
  light: boolean;
}) {
  return (
    <div style={{ width: size, height: size }}>
      <Canvas camera={{ position: [0, 0, 3.4], fov: 38 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <OrbMesh thinking={thinking} pulseKey={pulseKey} light={light} />
      </Canvas>
    </div>
  );
}
