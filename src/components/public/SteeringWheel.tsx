"use client";

import { PointerEvent, useRef, useState } from "react";

export function SteeringWheel() {
  const [rotation, setRotation] = useState(0);
  const lastX = useRef<number | null>(null);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (lastX.current === null) {
      lastX.current = event.clientX;
      return;
    }

    const delta = event.clientX - lastX.current;
    lastX.current = event.clientX;
    setRotation((current) => current + delta * 1.35);
  }

  function resetPointer() {
    lastX.current = null;
  }

  return (
    <div
      className="steering-wheel-wrap"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      role="img"
      aria-label="Steering wheel below the word behind"
    >
      <div className="steering-wheel" style={{ transform: `rotate(${rotation}deg)` }}>
        <span className="steering-wheel-spoke steering-wheel-spoke-left" />
        <span className="steering-wheel-spoke steering-wheel-spoke-right" />
        <span className="steering-wheel-spoke steering-wheel-spoke-bottom" />
        <span className="steering-wheel-hub" />
      </div>
      <p>Move across the wheel to turn it</p>
    </div>
  );
}
