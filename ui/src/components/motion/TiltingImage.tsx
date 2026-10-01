import { readMotionNumber, sampleCssEasing, createNoiseChannels, sampleNoise } from "./motion-runtime";
import "./tilting-image.css";
import { useCallback, useEffect, useRef, useState } from "react";

function readStr(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const { horizontal: nzR, vertical: nzG } = createNoiseChannels(11);

type BendState = {
  snap: Uint8ClampedArray;
  outData: ImageData;
  latFX: Float32Array;
  latFY: Float32Array;
  latW: number;
  padDev: number;
  sw: number;
  sh: number;
  dpr: number;
  LAT: number;
};

export function TiltingImage({ src, alt = "", openLabel, closeLabel, playing = true }: { src: string; alt?: string; openLabel: string; closeLabel: string; playing?: boolean }) {
  const [instant, setInstant] = useState(false);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bendRaf = useRef<number | null>(null);
  const bend = useRef<BendState | null>(null);

  const runBend = useCallback((sign: number, flightMs: number) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const card = cardRef.current;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const cctx = canvas ? canvas.getContext("2d") : null;
    if (!card || !canvas || !cctx || !img?.complete || !img.naturalWidth) return;
    const strength = readMotionNumber("--tilting-image-bend", 0);
    if (!strength) return;
    const explicit = readMotionNumber("--tilting-image-bend-dur", 0);
    const durMs = explicit > 0 ? explicit : flightMs;
    if (durMs <= 0) return;
    const ease = sampleCssEasing(readStr("--tilting-image-bend-ease"));
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const sw = Math.max(2, Math.round(cw * dpr));
    const sh = Math.max(2, Math.round(ch * dpr));
    const pad = Math.ceil(Math.abs(strength) * 0.32) + 4;
    const padDev = Math.round(pad * dpr);
    canvas.style.left = -pad + "px";
    canvas.style.top = -pad + "px";
    canvas.style.width = (cw + pad * 2) + "px";
    canvas.style.height = (ch + pad * 2) + "px";
    canvas.width = sw + padDev * 2;
    canvas.height = sh + padDev * 2;
    const outData = cctx.createImageData(canvas.width, canvas.height);
    const sc = document.createElement("canvas");
    sc.width = sw;
    sc.height = sh;
    const scx = sc.getContext("2d");
    if (!scx) return;
    if (img && img.naturalWidth) {
      const k = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
      const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      scx.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
    }
    let snap: Uint8ClampedArray;
    try { snap = scx.getImageData(0, 0, sw, sh).data; } catch { return; }
    const LAT = 8;
    const latW = Math.ceil(canvas.width / LAT) + 2;
    const latH = Math.ceil(canvas.height / LAT) + 2;
    const latFX = new Float32Array(latW * latH);
    const latFY = new Float32Array(latW * latH);
    for (let ly = 0; ly < latH; ly++) {
      const py = (ly * LAT - padDev) / dpr;
      for (let lx = 0; lx < latW; lx++) {
        const px = (lx * LAT - padDev) / dpr;
        const q = (2 * px - cw) / (1.4 * cw);
        const li = ly * latW + lx;
        latFX[li] = 0.0016 + 0.09 * sampleNoise(nzR, px, py, 110, 70);
        latFY[li] = 0.4116 * (1 - q * q) - 0.41 + 0.09 * sampleNoise(nzG, px, py, 110, 70);
      }
    }
    bend.current = { snap, outData, latFX, latFY, latW, padDev, sw, sh, dpr, LAT };

    const render = (s: number, rCss: number) => {
      const st = bend.current!;
      const rr = rCss * st.dpr;
      const W = canvas.width, H = canvas.height;
      const srcD = st.snap, dst = st.outData.data;
      const sDev = s * st.dpr;
      const invLat = 1 / st.LAT;
      let di = 0;
      for (let y = 0; y < H; y++) {
        const gy = y * invLat, gy0 = gy | 0, fyL = gy - gy0;
        const row0 = gy0 * st.latW, row1 = row0 + st.latW;
        for (let x = 0; x < W; x++, di += 4) {
          const gx = x * invLat, gx0 = gx | 0, fxL = gx - gx0;
          const a = row0 + gx0, b = row1 + gx0;
          const Fx = (st.latFX[a] + (st.latFX[a + 1] - st.latFX[a]) * fxL) * (1 - fyL) +
                     (st.latFX[b] + (st.latFX[b + 1] - st.latFX[b]) * fxL) * fyL;
          const Fy = (st.latFY[a] + (st.latFY[a + 1] - st.latFY[a]) * fxL) * (1 - fyL) +
                     (st.latFY[b] + (st.latFY[b + 1] - st.latFY[b]) * fxL) * fyL;
          const sxf = x - st.padDev + sDev * Fx;
          const syf = y - st.padDev + sDev * Fy;
          const dx1 = Math.min(sxf, st.sw - sxf);
          const dy1 = Math.min(syf, st.sh - syf);
          let d: number;
          if (dx1 < rr && dy1 < rr) {
            const ax = rr - dx1, ay = rr - dy1;
            d = rr - Math.sqrt(ax * ax + ay * ay);
          } else {
            d = Math.min(dx1, dy1);
          }
          if (d <= 0) {
            dst[di + 3] = 0;
            continue;
          }
          let sx0 = Math.floor(sxf), sy0 = Math.floor(syf);
          if (sx0 < 0) sx0 = 0; else if (sx0 > st.sw - 2) sx0 = st.sw - 2;
          if (sy0 < 0) sy0 = 0; else if (sy0 > st.sh - 2) sy0 = st.sh - 2;
          const u = Math.min(Math.max(sxf - sx0, 0), 1);
          const v = Math.min(Math.max(syf - sy0, 0), 1);
          const w00 = (1 - u) * (1 - v), w10 = u * (1 - v);
          const w01 = (1 - u) * v, w11 = u * v;
          const i00 = (sy0 * st.sw + sx0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + st.sw * 4;
          const i11 = i01 + 4;
          dst[di] = srcD[i00] * w00 + srcD[i10] * w10 + srcD[i01] * w01 + srcD[i11] * w11;
          dst[di + 1] = srcD[i00 + 1] * w00 + srcD[i10 + 1] * w10 + srcD[i01 + 1] * w01 + srcD[i11 + 1] * w11;
          dst[di + 2] = srcD[i00 + 2] * w00 + srcD[i10 + 2] * w10 + srcD[i01 + 2] * w01 + srcD[i11 + 2] * w11;
          dst[di + 3] = d >= 1 ? 255 : 255 * d;
        }
      }
      cctx.putImageData(st.outData, 0, 0);
    };
    const rFrom = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    const rTo = sign > 0 ? 16 : 32;
    const flightEase = sampleCssEasing(
      readStr(sign > 0 ? "--tilting-image-open-ease" : "--tilting-image-close-ease")
    );
    if (bendRaf.current) cancelAnimationFrame(bendRaf.current);
    card.classList.add("is-bending");
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / durMs, 1);
      const e = Math.min(Math.max(ease(p), 0), 1);
      const p2 = Math.min((now - t0) / Math.max(flightMs, 1), 1);
      render(strength * sign * Math.sin(Math.PI * e), rFrom + (rTo - rFrom) * flightEase(p2));
      if (p < 1) bendRaf.current = requestAnimationFrame(tick);
      else {
        bendRaf.current = null;
        card.classList.remove("is-bending");
      }
    };
    tick(t0);
  }, []);

  const toggle = useCallback((animate = true) => {
    setInstant(!animate || !playing);
    if (open) {
      setOpen(false);
      setClosing(animate && playing && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (animate && playing) runBend(-0.6, readMotionNumber("--tilting-image-close-dur", 420));
    } else {
      setClosing(false);
      setOpen(true);
      if (animate && playing) runBend(1, readMotionNumber("--tilting-image-open-dur", 620));
    }
  }, [open, runBend, playing]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === "oa-tilting-image-close") setClosing(false);
    };
    card.addEventListener("animationend", onEnd);
    const stop = () => {
      if (bendRaf.current !== null) cancelAnimationFrame(bendRaf.current);
      bendRaf.current = null;
      bend.current = null;
      card.classList.remove("is-bending");
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => { if (media.matches) { stop(); setClosing(false); } };
    const onVisibility = () => { if (document.hidden) stop(); };
    media.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      card.removeEventListener("animationend", onEnd);
      media.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [src, playing]);

  return (
    <div className="oa-tilting-image-stage">
      <button
        ref={cardRef}
        type="button"
        className={
          "oa-tilting-image-card" + (open ? " is-open" : "") + (closing ? " is-closing" : "")
        }
        data-instant={instant}
        aria-expanded={open}
        aria-label={open ? closeLabel : openLabel}
        onClick={event => toggle(event.detail > 0)}
        onKeyDown={event => { if (event.key === "Escape" && open) toggle(false); }}
      >
        <img ref={imgRef} className="oa-tilting-image-img" src={src} alt={alt} />

        <canvas ref={canvasRef} className="oa-tilting-image-canvas" aria-hidden />
      </button>
    </div>
  );
}
