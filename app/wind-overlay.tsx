"use client";

import { useEffect, useRef } from "react";
import { windFlowAngleRadians, type WindSample } from "../lib/wind";

type Particle = { x: number; y: number; age: number; life: number };

export default function WindOverlay({ sample, visible, mapRotationDegrees = 0 }: { sample: WindSample | null; visible: boolean; mapRotationDegrees?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !sample) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles: Particle[] = Array.from({ length: 52 }, (_, index) => ({ x: (index * 73 % 101) / 101, y: (index * 47 % 97) / 97, age: index % 40, life: 45 + index % 35 }));
    const angle = windFlowAngleRadians(sample.directionDegrees) + mapRotationDegrees * Math.PI / 180;
    const magnitude = Math.min(2.4, .35 + sample.speedKnots / 14);
    let animation = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1.35;
      context.lineCap = "round";
      context.strokeStyle = sample.speedKnots >= 22 ? "rgba(255,116,95,.82)" : sample.speedKnots >= 12 ? "rgba(255,210,122,.78)" : "rgba(132,241,220,.72)";
      for (const particle of particles) {
        if (!reducedMotion) {
          particle.x += Math.cos(angle) * magnitude / Math.max(160, width);
          particle.y += Math.sin(angle) * magnitude / Math.max(160, height);
          particle.age += 1;
          if (particle.x < -.05 || particle.x > 1.05 || particle.y < -.05 || particle.y > 1.05 || particle.age > particle.life) {
            particle.x = ((particle.age * 67) % 101) / 101;
            particle.y = ((particle.age * 43) % 97) / 97;
            particle.age = 0;
          }
        }
        const x = particle.x * width;
        const y = particle.y * height;
        const tail = 7 + Math.min(15, sample.speedKnots * .55);
        context.globalAlpha = .3 + .7 * Math.sin(Math.PI * Math.min(1, particle.age / particle.life));
        context.beginPath();
        context.moveTo(x - Math.cos(angle) * tail, y - Math.sin(angle) * tail);
        context.lineTo(x, y);
        context.stroke();
      }
      context.globalAlpha = 1;
      if (!reducedMotion) animation = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const observer = new ResizeObserver(() => { resize(); draw(); });
    observer.observe(canvas);
    return () => { cancelAnimationFrame(animation); observer.disconnect(); context.clearRect(0, 0, canvas.width, canvas.height); };
  }, [mapRotationDegrees, sample, visible]);

  return <canvas ref={canvasRef} className={`wind-overlay ${visible && sample ? "visible" : ""}`} aria-hidden="true" />;
}
