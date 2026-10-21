"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { orbFragment, orbVertex } from "./shaders";

// The AI orb as a real 3D glass sphere. It breathes when idle, churns while thinking,
// and bumps once whenever `pulseKey` changes (a result landed).
export function OrbMesh({
  radius = 1,
  thinking = false,
  pulseKey = 0,
  light = false,
  still = false,
}: {
  radius?: number;
  thinking?: boolean;
  pulseKey?: number;
  light?: boolean;
  still?: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const bump = useRef(0);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uAmp: { value: 0.04 }, uLight: { value: 0 } }), []);

  useEffect(() => {
    if (pulseKey > 0) bump.current = 1;
  }, [pulseKey]);

  useFrame(({ clock }, dt) => {
    const u = material.current?.uniforms;
    if (!u || !mesh.current) return;
    const t = clock.elapsedTime;
    if (!still) u.uTime.value = t;
    u.uAmp.value = THREE.MathUtils.lerp(u.uAmp.value, thinking ? 0.06 : 0.018, 0.06);
    u.uLight.value = THREE.MathUtils.lerp(u.uLight.value, light ? 1 : 0, 0.08);
    bump.current = Math.max(0, bump.current - dt * 1.6);
    const breathe = still ? 0 : Math.sin(t * (thinking ? 4 : 1.3)) * (thinking ? 0.035 : 0.025);
    mesh.current.scale.setScalar(1 + breathe + bump.current * 0.12);
    if (!still) mesh.current.rotation.y = t * 0.12;
  });

  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[radius, 96, 96]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={orbVertex}
        fragmentShader={orbFragment}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
