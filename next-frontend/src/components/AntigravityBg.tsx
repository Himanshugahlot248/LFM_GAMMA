"use client";

import { useEffect, useMemo, useRef } from "react";

type ThemeMode = "dark" | "light";

export function AntigravityBg({ mode }: { mode: ThemeMode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cursorRef = useRef({ x: 0, y: 0, tx: 0, ty: 0, hasCursor: false });

  const palette = useMemo(() => {
    if (mode === "dark") {
      return ["#7C3AED", "#22D3EE", "#F472B6", "#60A5FA", "#A78BFA", "#34D399"];
    }
    return ["#2563EB", "#7C3AED", "#EC4899", "#60A5FA", "#A78BFA", "#22C55E"];
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;

    const particleCount = window.innerWidth < 640 ? 90 : 170;
    const particles = new Array(particleCount).fill(0).map((_, i) => {
      // Deterministic pseudo-random spread (stable layout per mount).
      const seed = (i + 1) * 99991;
      const rx = Math.sin(seed) * 10000;
      const ry = Math.sin(seed * 1.7) * 10000;
      const rs = Math.sin(seed * 2.3) * 10000;
      const x = (rx - Math.floor(rx)) * 1; // 0..1
      const y = (ry - Math.floor(ry)) * 1;
      const sizeBase = (rs - Math.floor(rs)) * 1.6 + 0.6;
      const cIdx = Math.floor(((rs - Math.floor(rs)) * 997) % palette.length);
      return {
        x,
        y,
        r: sizeBase,
        c: palette[cIdx] ?? palette[0],
        phase: (i % 17) * 0.4,
        depth: 0.15 + ((x + y) % 1) * 0.85,
      };
    });

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (e: PointerEvent) => {
      cursorRef.current.tx = e.clientX;
      cursorRef.current.ty = e.clientY;
      cursorRef.current.hasCursor = true;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });

    const tick = (t: number) => {
      // Smooth cursor.
      const c = cursorRef.current;
      const ease = 0.08;
      c.x = c.hasCursor ? c.x + (c.tx - c.x) * ease : w * 0.5;
      c.y = c.hasCursor ? c.y + (c.ty - c.y) * ease : h * 0.25;

      // Clear: transparent canvas so body background still shows.
      ctx.clearRect(0, 0, w, h);

      const nx = (c.x / Math.max(1, w)) - 0.5; // -0.5..0.5
      const ny = (c.y / Math.max(1, h)) - 0.5;
      const maxShift = 28;

      // Draw dots
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const baseX = p.x * w;
        const baseY = p.y * h;
        const drift = Math.sin(t * 0.001 + p.phase) * 4;
        const shiftX = nx * maxShift * p.depth + drift * 0.15;
        const shiftY = ny * maxShift * p.depth - drift * 0.08;

        const x = baseX + shiftX;
        const y = baseY + shiftY;

        // Fade a bit near edges.
        const edgeFade =
          1 -
          Math.min(
            1,
            Math.abs(x - w / 2) / (w * 0.65) + Math.abs(y - h / 2) / (h * 0.65),
          );
        const alpha = (0.28 + p.depth * 0.45) * Math.max(0, edgeFade);

        ctx.beginPath();
        ctx.fillStyle = p.c;
        ctx.globalAlpha = alpha;
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [mode, palette]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 -z-10"
      aria-hidden
    />
  );
}

