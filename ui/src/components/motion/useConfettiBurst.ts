import { readMotionNumber } from "./motion-runtime";
import "./confetti-burst.css";
import { useCallback, useEffect, useRef } from "react";

const COLOR_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--terminal-magenta', '--terminal-cyan', '--terminal-yellow'];

type Particle = {
  start: number; x: number; y: number; py: number; vx: number; vy: number;
  w: number; h: number; maxFall: number; rot: number; vr: number;
  tumble: number; tumbleSpeed: number; squish: number; phase: number;
  swayFreq: number; swayScale: number; color: string;
  bounces: number; resting: boolean; dead: boolean;
};

export function useConfettiBurst(
  stageRef: React.RefObject<HTMLElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  btnRef: React.RefObject<HTMLElement | null>,
  enabled = true,
) {
  const frameRef = useRef<number | null>(null);
  const state = useRef({
    particles: [] as Particle[],
    running: false, lastT: 0, burstEnd: 0,
    fadeStart: null as number | null, stageW: 0, stageH: 0,
  });

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    state.current.running = false;
    state.current.particles = [];
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  const sizeCanvas = useCallback(() => {
    const stage = stageRef.current, canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.current.stageW = r.width;
    state.current.stageH = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [stageRef, canvasRef]);

  const burst = useCallback(() => {
    if (!enabled || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stage = stageRef.current, canvas = canvasRef.current, btn = btnRef.current;
    if (!stage || !canvas || !btn) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    stop();
    const s = state.current;
    sizeCanvas();

    const palette = getComputedStyle(document.documentElement);
    const colors = COLOR_TOKENS.map(name => palette.getPropertyValue(name).trim());
    const now = performance.now();
    const count = Math.min(160, Math.max(0, Math.round(readMotionNumber("--confetti-count", 120))));
    const size = readMotionNumber("--confetti-size", 8);
    const spawnWindow = 500;

    s.particles = [];
    s.fadeStart = null;
    for (let i = 0; i < count; i++) {
      s.particles.push({
        start: now + Math.random() * spawnWindow,
        x: Math.random() * s.stageW,
        y: -12 - Math.random() * 30,
        py: -12,
        vx: (Math.random() - 0.5) * 60,
        vy: 40 + Math.random() * 120,
        w: size * (0.7 + Math.random() * 0.6),
        h: size * (0.5 + Math.random() * 0.5),
        maxFall: 420 + Math.random() * 280,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 7,
        tumble: Math.random() * Math.PI * 2,
        tumbleSpeed: 4 + Math.random() * 8,
        squish: 1,
        phase: Math.random() * Math.PI * 2,
        swayFreq: 2 + Math.random() * 3,
        swayScale: 0.5 + Math.random(),
        color: colors[Math.floor(Math.random() * colors.length)],
        bounces: 0, resting: false, dead: false,
      });
    }
    s.burstEnd = now + spawnWindow + 100;

    const buttonRect = () => {
      const sr = stage.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return { left: b.left - sr.left, top: b.top - sr.top, right: b.right - sr.left, bottom: b.bottom - sr.top };
    };
    const bounds = buttonRect();
    const gravity = readMotionNumber("--confetti-gravity", 1300);
    const sway = readMotionNumber("--confetti-sway", 16);
    const restitution = readMotionNumber("--confetti-bounce", 0.3);
    const holdMs = readMotionNumber("--confetti-hold", 1600);
    const fadeMs = Math.max(readMotionNumber("--confetti-fade", 600), 1);
    const buttonSurface = (x: number, b: ReturnType<typeof buttonRect>) => {
      if (x < b.left || x > b.right) return null;
      const r = (b.bottom - b.top) / 2;
      const lc = b.left + r, rc = b.right - r;
      if (x >= lc && x <= rc) return { y: b.top, slope: 0 };
      const cx = x < lc ? lc : rc;
      const dx = x - cx;
      const root = Math.sqrt(Math.max(r * r - dx * dx, 0));
      return { y: b.top + (r - root), slope: dx / Math.max(root, 0.001) };
    };

    const step = (dt: number, now2: number) => {
      const b = bounds;
      for (const p of s.particles) {
        if (p.resting || p.dead || now2 < p.start) continue;
        p.py = p.y;
        p.vy += gravity * dt;
        if (p.vy > p.maxFall) p.vy = p.maxFall;
        p.phase += p.swayFreq * dt;
        p.x += (p.vx + Math.cos(p.phase) * sway * p.swayScale) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.tumble += p.tumbleSpeed * dt;
        p.squish = 0.25 + 0.75 * Math.abs(Math.cos(p.tumble));
        const half = p.h / 2;
        if (p.vy > 0) {
          const surf = buttonSurface(p.x, b);
          if (surf && p.y + half >= surf.y && p.py + half <= surf.y + 2) {
            if (Math.abs(surf.slope) > 0.85) {
              const dir = p.x < (b.left + b.right) / 2 ? -1 : 1;
              p.vx = dir * Math.max(Math.abs(p.vx), 50 + Math.random() * 50);
              p.vy *= 0.35;
              p.y = surf.y - half;
            } else if (p.vy > 150 && p.bounces < 2) {
              p.bounces++;
              p.vy = -p.vy * restitution * (0.6 + Math.random() * 0.5);
              p.vx = p.vx * 0.7 + surf.slope * 40 + (Math.random() - 0.5) * 40;
              p.y = surf.y - half;
            } else {
              p.resting = true; p.y = surf.y - half - 0.5; p.vx = 0; p.vy = 0;
            }
          }
        }
        if (!p.resting && p.y + half >= s.stageH - 1) {
          if (p.vy > 170 && p.bounces < 2) {
            p.bounces++;
            p.vy = -p.vy * restitution * (0.5 + Math.random() * 0.4);
            p.vx *= 0.7;
            p.y = s.stageH - 1 - half;
          } else {
            p.resting = true; p.y = s.stageH - 1 - half; p.vx = 0; p.vy = 0;
          }
        }
        if (p.x < -30 || p.x > s.stageW + 30 || p.y > s.stageH + 30) p.dead = true;
      }
    };

    const draw = (alpha: number) => {
      ctx.clearRect(0, 0, s.stageW, s.stageH);
      ctx.globalAlpha = alpha;
      const now2 = performance.now();
      for (const p of s.particles) {
        if (p.dead || now2 < p.start) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, p.squish);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now2: number) => {
      if (!s.running) return;
      let remaining = Math.min((now2 - s.lastT) / 1000, 0.25);
      s.lastT = now2;
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 60);
        step(dt, now2);
        remaining -= dt;
      }
      const settled = now2 > s.burstEnd && s.particles.every((p) => p.resting || p.dead);
      if (settled && s.fadeStart === null) s.fadeStart = now2 + holdMs;
      let alpha = 1;
      if (s.fadeStart !== null && now2 >= s.fadeStart) {
        const fade = fadeMs;
        alpha = 1 - (now2 - s.fadeStart) / fade;
        if (alpha <= 0) {
          s.running = false;
          s.particles = [];
          ctx.clearRect(0, 0, s.stageW, s.stageH);
          return;
        }
      }
      draw(alpha);
      frameRef.current = requestAnimationFrame(frame);
    };

    if (!s.running) {
      s.running = true;
      s.lastT = now;
      frameRef.current = requestAnimationFrame(frame);
    }
  }, [stageRef, canvasRef, btnRef, sizeCanvas, stop, enabled]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => { if (media.matches) stop(); };
    const onVisibility = () => { if (document.hidden) stop(); };
    const observer = new IntersectionObserver(entries => { if (entries.every(entry => !entry.isIntersecting)) stop(); });
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("resize", stop);
    document.addEventListener("visibilitychange", onVisibility);
    media.addEventListener("change", onMotionChange);
    if (!enabled) stop();
    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener("resize", stop);
      document.removeEventListener("visibilitychange", onVisibility);
      media.removeEventListener("change", onMotionChange);
    };
  }, [stop, stageRef, enabled]);

  return burst;
}
