import { readMotionNumber } from "./motion-runtime";
import "./drop-interaction.css";
import { useEffect, useRef, type RefObject } from "react";

export function useDropInteraction(
  chipRef: RefObject<HTMLElement | null>,
  zoneRef: RefObject<HTMLElement | null>,
  puffsRef: RefObject<SVGGElement | null>,
  opts?: Pick<DropInteractionOptions, "onDrop">,
): void {
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    const chip = chipRef.current;
    const zone = zoneRef.current;
    const puffs = puffsRef.current;
    if (!chip || !zone || !puffs) return;
    const ctrl = createDropInteraction({
      chip,
      zone,
      puffs,
      onDrop: () => cb.current?.onDrop?.(),
    });
    return () => ctrl.destroy();
  }, [chipRef, zoneRef, puffsRef]);
}

const SVG_NS = "http://www.w3.org/2000/svg";

export interface DropInteractionOptions {

  chip: HTMLElement;

  zone: HTMLElement;

  puffs: SVGGElement;

  onDrop?: () => void;
}

export interface DragDropController {

  destroy: () => void;
}

export function createDropInteraction({
  chip,
  zone,
  puffs,
  onDrop,
}: DropInteractionOptions): DragDropController {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  let destroyed = false;
  let dragging = false;
  let settling = false;
  let pointerId: number | null = null;
  let startX = 0, startY = 0;
  let dx = 0, dy = 0;
  let lastX = 0, lastT = 0;
  let revertTimer: number | undefined;
  const timers = new Set<number>();
  function after(ms: number, fn: () => void): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function setVars(x: number, y: number, tilt: number | null, lift: number | null): void {
    chip.style.setProperty("--dx", x.toFixed(1) + "px");
    chip.style.setProperty("--dy", y.toFixed(1) + "px");
    if (tilt !== null) chip.style.setProperty("--tilt", tilt.toFixed(2) + "deg");
    if (lift !== null) chip.style.setProperty("--lift", String(lift));
  }
  function overZone(): boolean {
    const c = chip.getBoundingClientRect();
    const z = zone.getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    return cx >= z.left && cx <= z.right && cy >= z.top && cy <= z.bottom;
  }
  const smokeTurb = puffs.ownerSVGElement?.querySelector<SVGFETurbulenceElement>("feTurbulence");
  const smokeDisp = puffs.ownerSVGElement?.querySelector<SVGFEDisplacementMapElement>("feDisplacementMap");
  const smokeBlur = puffs.ownerSVGElement?.querySelector<SVGFEGaussianBlurElement>("feGaussianBlur");
  function applySmokeKnobs(): void {
    if (smokeTurb) smokeTurb.setAttribute("baseFrequency",
      readMotionNumber("--drop-smoke-freq-x", 0.046) + " " + readMotionNumber("--drop-smoke-freq-y", 0.046));
    if (smokeDisp) smokeDisp.setAttribute("scale", String(readMotionNumber("--drop-smoke-warp", 30)));
    if (smokeBlur) smokeBlur.setAttribute("stdDeviation", String(readMotionNumber("--drop-smoke-blur", 5)));
  }
  function buildPuffs(): void {
    applySmokeKnobs();
    const dist = readMotionNumber("--drop-puff-dist", 30);
    const dur = readMotionNumber("--drop-puff-dur", 1500);
    const count = Math.min(8, Math.max(1, Math.round(readMotionNumber("--drop-wave-count", 1))));
    const baseW = readMotionNumber("--drop-wave-width", 50);
    const falloff = readMotionNumber("--drop-wave-falloff", 20);
    const stagger = readMotionNumber("--drop-wave-stagger", 150);
    const grow = readMotionNumber("--drop-wave-grow", 0.28);
    const travel = 1 + (dist * 2) / zone.offsetWidth;
    puffs.replaceChildren();
    for (let w = 0; w < count; w++) {
      const wave = document.createElementNS(SVG_NS, "rect");
      const sw = Math.max(2, baseW - w * falloff);
      const hw = sw / 2;
      wave.setAttribute("class", "oa-drop-wave");
      wave.setAttribute("x", String(52 + hw));
      wave.setAttribute("y", String(52 + hw));
      wave.setAttribute("width", String(Math.max(1, 100 - sw)));
      wave.setAttribute("height", String(Math.max(1, 100 - sw)));
      wave.setAttribute("rx", String(Math.max(2, 14 - hw)));
      wave.setAttribute("stroke-width", String(sw));
      wave.style.setProperty("--wdur", Math.round(dur * (0.85 + w * grow)) + "ms");
      wave.style.setProperty("--wdelay", Math.round(w * stagger) + "ms");
      wave.style.setProperty("--wscale", (travel + w * 0.07).toFixed(3));
      puffs.appendChild(wave);
    }
  }

  function land(): void {
    zone.classList.add("is-filled", "is-landing");
    if (!reduced.matches) {
      buildPuffs();
      after(readMotionNumber("--drop-down-dur", 250) + readMotionNumber("--drop-wave-delay", 0), () => {
        zone.classList.add("is-bursting");
      });
    }
    if (onDrop) onDrop();
    if (destroyed) return;
    window.clearTimeout(revertTimer);
    revertTimer = after(readMotionNumber("--drop-hold", 1800), () => {
      zone.classList.add("is-emptying");
      after(readMotionNumber("--drop-out-dur", 400) + 50, () => {
        zone.classList.remove("is-filled", "is-emptying", "is-bursting", "is-landing");
        dx = 0; dy = 0;
        setVars(0, 0, 0, 1);
        void chip.offsetWidth;
        chip.classList.remove("is-fading");
        chip.classList.add("is-respawning");
        after(readMotionNumber("--drop-respawn-dur", 250) + 50, () => {
          chip.classList.remove("is-respawning");
          settling = false;
        });
      });
    });
  }

  function onPointerDown(e: PointerEvent): void {
    if (destroyed || dragging || settling || e.button !== 0 || !e.isPrimary) return;
    dragging = true;
    pointerId = e.pointerId;
    try { chip.setPointerCapture(pointerId); } catch (_) {}
    startX = e.clientX - dx;
    startY = e.clientY - dy;
    lastX = e.clientX;
    lastT = performance.now();
    chip.classList.remove("is-returning", "is-respawning");
    chip.classList.add("is-dragging");
    chip.style.setProperty("--lift", String(readMotionNumber("--drop-lift-scale", 1.05)));
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    const now = performance.now();
    const dt = Math.max(now - lastT, 1);
    const vx = (e.clientX - lastX) / dt;
    lastX = e.clientX;
    lastT = now;
    const tiltMax = readMotionNumber("--drop-tilt-max", 10);
    const tilt = Math.max(-tiltMax, Math.min(tiltMax, vx * 28));
    setVars(dx, dy, tilt, null);
    zone.classList.toggle("is-over", !zone.classList.contains("is-filled") && overZone());
  }

  function release(e: PointerEvent): void {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    chip.classList.remove("is-dragging");
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    setVars(dx, dy, 0, null);
    const dropIn = e.type === "pointerup" && !zone.classList.contains("is-filled") && overZone();
    if (pointerId !== null && chip.hasPointerCapture(pointerId)) chip.releasePointerCapture(pointerId);
    pointerId = null;
    zone.classList.remove("is-over");
    if (dropIn) {
      settling = true;
      setVars(dx, dy, 0, null);
      chip.classList.add("is-fading");
      land();
    } else {
      settling = true;
      chip.classList.add("is-returning");
      dx = 0; dy = 0;
      setVars(0, 0, 0, 1);
      after(readMotionNumber("--drop-return-dur", 500) + 50, () => {
        chip.classList.remove("is-returning");
        settling = false;
      });
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.key === "Enter" || event.key === " ") && !settling && !dragging) {
      event.preventDefault();
      settling = true;
      chip.classList.add("is-fading");
      land();
    }
    if (event.key === "Escape" && dragging && pointerId !== null) {
      release(new PointerEvent("pointercancel", { pointerId, clientX: startX + dx, clientY: startY + dy }));
    }
  }
  chip.addEventListener("keydown", onKeyDown);
  chip.addEventListener("lostpointercapture", release);
  chip.addEventListener("pointerdown", onPointerDown);
  chip.addEventListener("pointermove", onPointerMove);
  chip.addEventListener("pointerup", release);
  chip.addEventListener("pointercancel", release);

  function destroy(): void {
    destroyed = true;
    if (pointerId !== null && chip.hasPointerCapture(pointerId)) chip.releasePointerCapture(pointerId);
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    chip.removeEventListener("pointerdown", onPointerDown);
    chip.removeEventListener("pointermove", onPointerMove);
    chip.removeEventListener("pointerup", release);
    chip.removeEventListener("pointercancel", release);
    chip.removeEventListener("lostpointercapture", release);
    chip.removeEventListener("keydown", onKeyDown);
    zone.classList.remove("is-over", "is-filled", "is-landing", "is-bursting", "is-emptying");
    chip.classList.remove("is-dragging", "is-fading", "is-returning", "is-respawning");
    setVars(0, 0, 0, 1);
    puffs.replaceChildren();
  }

  return { destroy };
}
