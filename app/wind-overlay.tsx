"use client";

import { useEffect, useRef } from "react";
import { windFlowAngleRadians, type WindSample } from "../lib/wind";

type Particle = { x: number; y: number; age: number; life: number; speed: number };

export default function WindOverlay({ sample, visible, mapRotationDegrees = 0 }: { sample: WindSample | null; visible: boolean; mapRotationDegrees?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !sample) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles: Particle[] = Array.from({ length: 96 }, (_, index) => ({
      x: (index * 73 % 101) / 101,
      y: (index * 47 % 97) / 97,
      age: index % 80,
      life: 90 + index % 70,
      speed: .72 + (index % 9) / 20,
    }));
    const angle = windFlowAngleRadians(sample.directionDegrees) + mapRotationDegrees * Math.PI / 180;
    const magnitude = Math.min(2.8, .65 + sample.speedKnots / 12);
    let animation = 0;
    let normalColour = "rgba(112,238,214,.9)";
    let strongColour = "rgba(255,203,92,.92)";
    let dangerColour = "rgba(255,100,82,.94)";

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const styles = getComputedStyle(canvas);
      normalColour = styles.getPropertyValue("--wind-flow-colour").trim() || normalColour;
      strongColour = styles.getPropertyValue("--wind-flow-strong-colour").trim() || strongColour;
      dangerColour = styles.getPropertyValue("--wind-flow-danger-colour").trim() || dangerColour;
    };

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1.9;
      context.lineCap = "round";
      context.strokeStyle = sample.speedKnots >= 22 ? dangerColour : sample.speedKnots >= 12 ? strongColour : normalColour;
      context.fillStyle = context.strokeStyle;
      for (const particle of particles) {
        if (!reducedMotion) {
          particle.x += Math.cos(angle) * magnitude * particle.speed / Math.max(160, width);
          particle.y += Math.sin(angle) * magnitude * particle.speed / Math.max(160, height);
          particle.age += 1;
          if (particle.x < -.05 || particle.x > 1.05 || particle.y < -.05 || particle.y > 1.05 || particle.age > particle.life) {
            particle.x = ((particle.age * 67) % 101) / 101;
            particle.y = ((particle.age * 43) % 97) / 97;
            particle.age = 0;
          }
        }
        const x = particle.x * width;
        const y = particle.y * height;
        const tail = 13 + Math.min(21, sample.speedKnots * .72);
        context.globalAlpha = .5 + .5 * Math.sin(Math.PI * Math.min(1, particle.age / particle.life));
        context.beginPath();
        context.moveTo(x - Math.cos(angle) * tail, y - Math.sin(angle) * tail);
        context.lineTo(x, y);
        context.stroke();
        context.beginPath();
        context.arc(x, y, 1.45, 0, Math.PI * 2);
        context.fill();
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
