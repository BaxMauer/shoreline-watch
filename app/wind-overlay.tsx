"use client";

import { useEffect, useRef } from "react";
import { createAnimationFrameLoop } from "../lib/animation-frame-loop";
import { windFlowAngleRadians, windFlowSpeedPixelsPerSecond, type WindSample } from "../lib/wind";

type Particle = { x: number; y: number; age: number; life: number; speed: number };

export default function WindOverlay({ sample, visible, mapRotationDegrees = 0 }: { sample: WindSample | null; visible: boolean; mapRotationDegrees?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleRef = useRef(sample);
  const rotationRef = useRef(mapRotationDegrees);
  const hasSample = sample !== null;

  useEffect(() => { sampleRef.current = sample; }, [sample]);
  useEffect(() => { rotationRef.current = mapRotationDegrees; }, [mapRotationDegrees]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || !sampleRef.current) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionQuery.matches;
    const particles: Particle[] = Array.from({ length: 96 }, (_, index) => ({
      x: (index * 73 % 101) / 101,
      y: (index * 47 % 97) / 97,
      age: index % 80,
      life: 90 + index % 70,
      speed: .72 + (index % 9) / 20,
    }));
    let lastFrameAt = 0;
    let stopped = false;
    let inViewport = true;
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

    const draw = (frameAt = 0) => {
      const activeSample = sampleRef.current;
      if (!activeSample || stopped) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const angle = windFlowAngleRadians(activeSample.directionDegrees) + rotationRef.current * Math.PI / 180;
      const speed = windFlowSpeedPixelsPerSecond(activeSample.speedKnots, activeSample.gustKnots);
      const elapsedSeconds = lastFrameAt && frameAt ? Math.min(.05, Math.max(0, (frameAt - lastFrameAt) / 1_000)) : 0;
      lastFrameAt = frameAt;
      context.clearRect(0, 0, width, height);
      context.lineWidth = 2.2;
      context.lineCap = "round";
      context.strokeStyle = activeSample.gustKnots >= 28 || activeSample.speedKnots >= 22 ? dangerColour : activeSample.gustKnots >= 18 || activeSample.speedKnots >= 12 ? strongColour : normalColour;
      context.fillStyle = context.strokeStyle;
      for (const particle of particles) {
        if (!reducedMotion && speed > 0) {
          particle.x += Math.cos(angle) * speed * particle.speed * elapsedSeconds / Math.max(160, width);
          particle.y += Math.sin(angle) * speed * particle.speed * elapsedSeconds / Math.max(160, height);
          particle.age += elapsedSeconds * 60;
          if (particle.x < -.05 || particle.x > 1.05 || particle.y < -.05 || particle.y > 1.05 || particle.age > particle.life) {
            particle.x = ((particle.age * 67) % 101) / 101;
            particle.y = ((particle.age * 43) % 97) / 97;
            particle.age = 0;
          }
        }
        const x = particle.x * width;
        const y = particle.y * height;
        const tail = speed === 0 ? 5 : 13 + Math.min(21, activeSample.speedKnots * .72);
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
    };

    const frameLoop = createAnimationFrameLoop(
      (callback) => requestAnimationFrame(callback),
      (identifier) => cancelAnimationFrame(identifier),
      draw,
    );

    const start = () => {
      frameLoop.stop();
      lastFrameAt = 0;
      if (!inViewport || document.visibilityState !== "visible") return;
      if (reducedMotion) draw();
      else frameLoop.start();
    };

    const handleMotionChange = () => { reducedMotion = motionQuery.matches; start(); };
    const handleVisibilityChange = () => start();

    resize();
    start();
    const observer = new ResizeObserver(() => { resize(); if (reducedMotion) draw(); });
    observer.observe(canvas);
    const viewportObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? false;
      start();
    }, { threshold: .01 });
    viewportObserver.observe(canvas);
    motionQuery.addEventListener("change", handleMotionChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopped = true;
      frameLoop.stop();
      observer.disconnect();
      viewportObserver.disconnect();
      motionQuery.removeEventListener("change", handleMotionChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [hasSample, visible]);

  return <canvas ref={canvasRef} className={`wind-overlay ${visible && sample ? "visible" : ""}`} aria-hidden="true" />;
}
