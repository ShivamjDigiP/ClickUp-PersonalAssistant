"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { OrbMesh } from "./OrbMesh";
import { glowFragment, glowVertex, planetFragment, planetVertex } from "./shaders";
import { CAM_Z, FOV, computeLayout, planetSpec, type Layout } from "./layout";
import { HEALTH_COLOR } from "@/lib/health";
import type { Project } from "@/app/api/pulse/route";

// Soft halo behind each planet (normal blending, so it also looks right on the light theme)
function Glow({ color, scale, strength }: { color: string; scale: number; strength: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } }), [color, strength]);
  useFrame(({ camera }) => ref.current?.quaternion.copy(camera.quaternion));
  return (
    <mesh ref={ref} scale={scale} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial uniforms={uniforms} vertexShader={glowVertex} fragmentShader={glowFragment} transparent depthWrite={false} />
    </mesh>
  );
}

function Planet({
  p,
  index,
  total,
  layout,
  still,
  light,
  hovered,
  onHover,
  onSelect,
}: {
  p: Project;
  index: number;
  total: number;
  layout: Layout;
  still: boolean;
  light: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (p: Project, x: number, y: number) => void;
}) {
  const g = useRef<THREE.Group>(null);
  const [over, setOver] = useState(false);
  const { bx, by, radius } = planetSpec(p.total, index, total, layout);
  const color = HEALTH_COLOR[p.health];
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(color) } }), [color]);
  const active = over || hovered;

  useFrame(({ clock }) => {
    if (!g.current) return;
    g.current.position.set(bx, by + (still ? 0 : Math.sin(clock.elapsedTime * 0.8 + index) * 0.06), 0);
    g.current.scale.setScalar(THREE.MathUtils.lerp(g.current.scale.x, active ? 1.12 : 1, 0.15));
  });

  return (
    <group ref={g} position={[bx, by, 0]}>
      <Glow color={color} scale={radius * 2.5} strength={light ? 0.22 : 0.34} />
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(p, e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOver={() => {
          setOver(true);
          onHover(p.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setOver(false);
          onHover(null);
          document.body.style.cursor = "";
        }}
      >
        <sphereGeometry args={[radius, 64, 64]} />
        <shaderMaterial uniforms={uniforms} vertexShader={planetVertex} fragmentShader={planetFragment} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function Sparks({ layout, still }: { layout: Layout; still: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({ a: i * 1.05 + 0.4, s: 0.05 + (i % 3) * 0.02, k: i % 2 ? 0.66 : 1.1, c: ["#ffb36b", "#6fe7ff", "#8b7bff", "#ff8fb1"][i % 4] })),
    [],
  );
  useFrame(({ clock }) => {
    seeds.forEach((s, i) => {
      const a = s.a + (still ? 0 : clock.elapsedTime * s.s);
      refs.current[i]?.position.set(Math.cos(a) * layout.rx * s.k, Math.sin(a) * layout.ry * s.k, -0.2);
    });
  });
  return (
    <>
      {seeds.map((s, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)}>
          <sphereGeometry args={[0.045 + (i % 3) * 0.012, 12, 12]} />
          <meshBasicMaterial color={s.c} />
        </mesh>
      ))}
    </>
  );
}

function Rings({ layout }: { layout: Layout }) {
  const pts = (k: number) =>
    Array.from({ length: 129 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * layout.rx * k, Math.sin(a) * layout.ry * k, -0.3);
    });
  return (
    <>
      <Line points={pts(1.1)} color="#9aa8ff" lineWidth={0.8} transparent opacity={0.22} />
      <Line points={pts(0.66)} color="#9aa8ff" lineWidth={0.7} transparent opacity={0.14} />
    </>
  );
}

export type SceneProps = {
  projects: Project[];
  onSelect: (p: Project, x: number, y: number) => void;
  thinking: boolean;
  pulseKey: number;
  light: boolean;
  still: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
};

function Scene({ projects, onSelect, thinking, pulseKey, light, still, hoveredId, onHover }: SceneProps) {
  const { size } = useThree();
  const layout = useMemo(() => computeLayout(size.width, size.height), [size.width, size.height]);
  return (
    <group>
      <Rings layout={layout} />
      <OrbMesh radius={layout.orbR} thinking={thinking} pulseKey={pulseKey} light={light} still={still} />
      <Sparks layout={layout} still={still} />
      {projects.map((p, i) => (
        <Planet
          key={p.id}
          p={p}
          index={i}
          total={projects.length}
          layout={layout}
          still={still}
          light={light}
          hovered={hoveredId === p.id}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

export default function PulseScene(props: SceneProps) {
  return (
    <Canvas camera={{ position: [0, 0, CAM_Z], fov: FOV }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <Scene {...props} />
    </Canvas>
  );
}
