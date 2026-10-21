"use client";

import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "motion/react";
import { useWebGL } from "./useWebGL";

const Orb3D = dynamic(() => import("./three/Orb3D"), { ssr: false });

// The AI's presence: breathes when idle, ripples while thinking, pulses once when a result lands.
// Large orbs (hero) render as a real 3D glass sphere; small ones (header, inline) stay as light CSS.
export function Orb({
  size = 96,
  thinking = false,
  pulseKey = 0,
  three = false,
  light = false,
}: {
  size?: number;
  thinking?: boolean;
  pulseKey?: number;
  three?: boolean;
  light?: boolean;
}) {
  const reduce = useReducedMotion();
  const webgl = useWebGL();

  if (three && webgl) {
    return (
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        {thinking &&
          !reduce &&
          [0, 1].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-full border border-violet-300/40"
              style={{ width: size * 0.8, height: size * 0.8 }}
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.9, ease: "easeOut" }}
            />
          ))}
        <Orb3D size={size} thinking={thinking} pulseKey={pulseKey} light={light} />
      </div>
    );
  }

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {thinking &&
        !reduce &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full border border-violet-300/50"
            style={{ width: size, height: size }}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 2.2, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.65, ease: "easeOut" }}
          />
        ))}
      <motion.div
        key={pulseKey}
        className="orb"
        style={{ width: size, height: size }}
        animate={reduce ? undefined : thinking ? { scale: [1, 1.08, 1] } : { scale: [1, 1.04, 1] }}
        transition={{ duration: thinking ? 1.1 : 4.5, repeat: Infinity, ease: "easeInOut" }}
      />
      {pulseKey > 0 && !reduce && (
        <motion.span
          key={`p${pulseKey}`}
          className="absolute rounded-full bg-violet-300/30"
          style={{ width: size, height: size }}
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 1.9, opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      )}
    </div>
  );
}
