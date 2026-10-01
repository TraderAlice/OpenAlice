import { readMotionNumber, sampleCssEasing, createNoiseChannels, sampleNoise } from "./motion-runtime";
import "./dissolve-effect.css";
import { useCallback, useEffect, useRef, type RefObject } from "react";

export function useDissolveEffect(
  stageRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  opts?: Pick<DissolveEffectOptions, "respawn" | "onComplete" | "enabled">,
): () => void {
  const ctrl = useRef<ReturnType<typeof createDissolveEffect> | null>(null);
  const options = useRef(opts);
  options.current = opts;
  useEffect(() => () => { ctrl.current?.destroy(); ctrl.current = null; }, []);
  useEffect(() => { if (opts?.enabled === false) { ctrl.current?.destroy(); ctrl.current = null; } }, [opts?.enabled]);
  return useCallback(() => {
    if (options.current?.enabled === false) { options.current.onComplete?.(); return; }
    if (!ctrl.current) {
      const stage = stageRef.current;
      const card = cardRef.current;
      const canvas = canvasRef.current;
      if (!stage || !card || !canvas) return;
      ctrl.current = createDissolveEffect({ stage, card, canvas, respawn: options.current?.respawn, onComplete: () => options.current?.onComplete?.() });
    }
    ctrl.current.dissolve();
  }, []);
}
function readStr(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export interface DissolveEffectOptions {

  stage: HTMLElement;

  card: HTMLElement;

  canvas: HTMLCanvasElement;

  respawn?: boolean;
  enabled?: boolean;

  onComplete?: () => void;
}

export function createDissolveEffect({
  stage,
  card,
  canvas,
  respawn = true,
  onComplete,
}: DissolveEffectOptions) {
  const context = canvas.getContext("2d");
  if (!context) return { dissolve: () => onComplete?.(), destroy: () => {} };
  const ctx = context;
  const workHalf = document.createElement("canvas");
  const snap = document.createElement("canvas");
  const halfContext = workHalf.getContext("2d");
  const snapshotContext = snap.getContext("2d");
  if (!halfContext || !snapshotContext) return { dissolve: () => onComplete?.(), destroy: () => {} };
  const whctx = halfContext;
  let running = false;
  let destroyed = false;
  let frameId: number | null = null;
  let respawnTimer: number | undefined;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const LAT = 4;
  let snapPre!: Uint8ClampedArray,
    workData!: ImageData,
    halfData!: ImageData,
    blurTmp!: Uint8ClampedArray;
  let pad = 0,
    padDev = 0,
    latW = 0,
    latH = 0;
  let workW = 0,
    workH = 0,
    wW2 = 0,
    wH2 = 0;
  let latDX!: Float32Array, latDY!: Float32Array;
  function boxH(
    srcA: Uint8ClampedArray,
    dstA: Uint8ClampedArray,
    w: number,
    h: number,
    r: number,
  ) {
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const base = y * w * 4;
      let sr = 0,
        sg = 0,
        sb = 0,
        sa = 0;
      for (let x = 0; x <= r && x < w; x++) {
        const i = base + x * 4;
        sr += srcA[i];
        sg += srcA[i + 1];
        sb += srcA[i + 2];
        sa += srcA[i + 3];
      }
      for (let x = 0; x < w; x++) {
        const o = base + x * 4;
        dstA[o] = sr * inv;
        dstA[o + 1] = sg * inv;
        dstA[o + 2] = sb * inv;
        dstA[o + 3] = sa * inv;
        const xa = x + r + 1;
        if (xa < w) {
          const ia = base + xa * 4;
          sr += srcA[ia];
          sg += srcA[ia + 1];
          sb += srcA[ia + 2];
          sa += srcA[ia + 3];
        }
        const xs = x - r;
        if (xs >= 0) {
          const is = base + xs * 4;
          sr -= srcA[is];
          sg -= srcA[is + 1];
          sb -= srcA[is + 2];
          sa -= srcA[is + 3];
        }
      }
    }
  }
  function boxV(
    srcA: Uint8ClampedArray,
    dstA: Uint8ClampedArray,
    w: number,
    h: number,
    r: number,
    straight: boolean,
  ) {
    const stride = w * 4;
    const inv = 1 / (2 * r + 1);
    for (let x = 0; x < w; x++) {
      const base = x * 4;
      let sr = 0,
        sg = 0,
        sb = 0,
        sa = 0;
      for (let y = 0; y <= r && y < h; y++) {
        const i = base + y * stride;
        sr += srcA[i];
        sg += srcA[i + 1];
        sb += srcA[i + 2];
        sa += srcA[i + 3];
      }
      for (let y = 0; y < h; y++) {
        const o = base + y * stride;
        const aOut = sa * inv;
        if (straight && aOut > 0.5 && aOut < 254.6) {
          const k = 255 / aOut;
          dstA[o] = sr * inv * k;
          dstA[o + 1] = sg * inv * k;
          dstA[o + 2] = sb * inv * k;
        } else {
          dstA[o] = sr * inv;
          dstA[o + 1] = sg * inv;
          dstA[o + 2] = sb * inv;
        }
        dstA[o + 3] = aOut;
        const ya = y + r + 1;
        if (ya < h) {
          const ia = base + ya * stride;
          sr += srcA[ia];
          sg += srcA[ia + 1];
          sb += srcA[ia + 2];
          sa += srcA[ia + 3];
        }
        const ys = y - r;
        if (ys >= 0) {
          const is = base + ys * stride;
          sr -= srcA[is];
          sg -= srcA[is + 1];
          sb -= srcA[is + 2];
          sa -= srcA[is + 3];
        }
      }
    }
  }
  function remap(
    dstArr: Uint8ClampedArray,
    dw: number,
    dh: number,
    s: number,
    straight: boolean,
  ) {
    const snapW = snap.width,
      snapH = snap.height;
    const src = snapPre;
    const invLat = 1 / LAT;
    let di = 0;
    for (let yD = 0; yD < dh; yD++) {
      const yF = yD * s;
      const gy = yF * invLat;
      const gy0 = gy | 0;
      const fy = gy - gy0;
      const row0 = gy0 * latW,
        row1 = row0 + latW;
      for (let xD = 0; xD < dw; xD++, di += 4) {
        const xF = xD * s;
        const gx = xF * invLat;
        const gx0 = gx | 0;
        const fx = gx - gx0;
        const a = row0 + gx0,
          b = row1 + gx0;
        const dxv =
          (latDX[a] + (latDX[a + 1] - latDX[a]) * fx) * (1 - fy) +
          (latDX[b] + (latDX[b + 1] - latDX[b]) * fx) * fy;
        const dyv =
          (latDY[a] + (latDY[a + 1] - latDY[a]) * fx) * (1 - fy) +
          (latDY[b] + (latDY[b + 1] - latDY[b]) * fx) * fy;
        const sxf = xF - padDev + dxv;
        const syf = yF - padDev + dyv;
        const sx0 = Math.floor(sxf);
        const sy0 = Math.floor(syf);
        let rC = 0,
          gC = 0,
          bC = 0,
          aC = 0;
        if (sx0 >= 0 && sx0 < snapW - 1 && sy0 >= 0 && sy0 < snapH - 1) {
          const u = sxf - sx0,
            v = syf - sy0;
          const w00 = (1 - u) * (1 - v),
            w10 = u * (1 - v);
          const w01 = (1 - u) * v,
            w11 = u * v;
          const i00 = (sy0 * snapW + sx0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + snapW * 4;
          const i11 = i01 + 4;
          rC = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
          gC =
            src[i00 + 1] * w00 +
            src[i10 + 1] * w10 +
            src[i01 + 1] * w01 +
            src[i11 + 1] * w11;
          bC =
            src[i00 + 2] * w00 +
            src[i10 + 2] * w10 +
            src[i01 + 2] * w01 +
            src[i11 + 2] * w11;
          aC =
            src[i00 + 3] * w00 +
            src[i10 + 3] * w10 +
            src[i01 + 3] * w01 +
            src[i11 + 3] * w11;
        } else if (sx0 >= -1 && sx0 <= snapW - 1 && sy0 >= -1 && sy0 <= snapH - 1) {
          const u = sxf - sx0,
            v = syf - sy0;
          let w, si;
          if (sx0 >= 0 && sy0 >= 0) {
            w = (1 - u) * (1 - v);
            si = (sy0 * snapW + sx0) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
          if (sx0 + 1 < snapW && sy0 >= 0) {
            w = u * (1 - v);
            si = (sy0 * snapW + sx0 + 1) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
          if (sx0 >= 0 && sy0 + 1 < snapH) {
            w = (1 - u) * v;
            si = ((sy0 + 1) * snapW + sx0) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
          if (sx0 + 1 < snapW && sy0 + 1 < snapH) {
            w = u * v;
            si = ((sy0 + 1) * snapW + sx0 + 1) * 4;
            rC += src[si] * w;
            gC += src[si + 1] * w;
            bC += src[si + 2] * w;
            aC += src[si + 3] * w;
          }
        } else {
          dstArr[di] = 0;
          dstArr[di + 1] = 0;
          dstArr[di + 2] = 0;
          dstArr[di + 3] = 0;
          continue;
        }
        if (straight && aC > 0.5 && aC < 254.6) {
          const k = 255 / aC;
          rC *= k;
          gC *= k;
          bC *= k;
        }
        dstArr[di] = rC;
        dstArr[di + 1] = gC;
        dstArr[di + 2] = bC;
        dstArr[di + 3] = aC;
      }
    }
  }
  const { horizontal: noiseR, vertical: noiseG } = createNoiseChannels(9);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cardX = 0,
    cardY = 0,
    cardW = 0,
    cardH = 0;
  function prepare(padCss: number) {
    const sr = stage.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    cardX = cr.left - sr.left;
    cardY = cr.top - sr.top;
    cardW = cr.width;
    cardH = cr.height;
    snap.width = Math.max(1, Math.round(cardW * dpr));
    snap.height = Math.max(1, Math.round(cardH * dpr));
    pad = Math.min(Math.ceil(padCss) + 6, 80);
    padDev = Math.round(pad * dpr);
    workW = snap.width + padDev * 2;
    workH = snap.height + padDev * 2;
    canvas.width = workW;
    canvas.height = workH;
    canvas.style.left = cardX - pad + "px";
    canvas.style.top = cardY - pad + "px";
    canvas.style.width = cardW + pad * 2 + "px";
    canvas.style.height = cardH + pad * 2 + "px";
    ctx.imageSmoothingQuality = "high";
    const sc = snapshotContext;
    if (!sc) return;
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc.clearRect(0, 0, cardW, cardH);
    const r = 16;
    sc.beginPath();
    sc.moveTo(r, 0);
    sc.arcTo(cardW, 0, cardW, cardH, r);
    sc.arcTo(cardW, cardH, 0, cardH, r);
    sc.arcTo(0, cardH, 0, 0, r);
    sc.arcTo(0, 0, cardW, 0, r);
    sc.closePath();
    sc.clip();
    const img = card.querySelector<HTMLImageElement>("img");
    if (img && img.naturalWidth) {
      const s = Math.max(cardW / img.naturalWidth, cardH / img.naturalHeight);
      const dw = img.naturalWidth * s,
        dh = img.naturalHeight * s;
      sc.drawImage(img, (cardW - dw) / 2, (cardH - dh) / 2, dw, dh);
    } else {
      sc.fillStyle = getComputedStyle(card).backgroundColor;
      sc.fillRect(0, 0, cardW, cardH);
    }
    const bx = cardW - 8 - 12,
      by = 8 + 12;
    sc.beginPath();
    sc.arc(bx, by, 12, 0, Math.PI * 2);
    sc.fillStyle = getComputedStyle(card).getPropertyValue("--popover");
    sc.fill();
    sc.strokeStyle = getComputedStyle(card).color;
    sc.lineWidth = 1.5;
    sc.lineCap = "round";
    sc.beginPath();
    sc.moveTo(bx - 3.5, by - 3.5);
    sc.lineTo(bx + 3.5, by + 3.5);
    sc.moveTo(bx + 3.5, by - 3.5);
    sc.lineTo(bx - 3.5, by + 3.5);
    sc.stroke();
    const sd = sc.getImageData(0, 0, snap.width, snap.height).data;
    snapPre = new Uint8ClampedArray(sd.length);
    for (let i = 0; i < sd.length; i += 4) {
      const aP = sd[i + 3];
      snapPre[i] = (sd[i] * aP) / 255;
      snapPre[i + 1] = (sd[i + 1] * aP) / 255;
      snapPre[i + 2] = (sd[i + 2] * aP) / 255;
      snapPre[i + 3] = aP;
    }
    workData = ctx.createImageData(workW, workH);
    wW2 = Math.ceil(workW / 2);
    wH2 = Math.ceil(workH / 2);
    workHalf.width = wW2;
    workHalf.height = wH2;
    halfData = whctx.createImageData(wW2, wH2);
    blurTmp = new Uint8ClampedArray(halfData.data.length);
    latW = Math.ceil(workW / LAT) + 2;
    latH = Math.ceil(workH / LAT) + 2;
    latDX = new Float32Array(latW * latH);
    latDY = new Float32Array(latW * latH);
  }

  function dissolve() {
    if (running || destroyed || document.hidden) return;
    if (media.matches) { onComplete?.(); return; }
    running = true;
    const durMs = readMotionNumber("--dissolve-dur", 900);
    const g = readMotionNumber("--dissolve-gravity", 900);
    const warp = readMotionNumber("--dissolve-warp", 90);
    const warpDurRaw = readMotionNumber("--dissolve-warp-dur", 0);
    const warpDurMs = warpDurRaw > 0 ? warpDurRaw : durMs;
    const maxBlur = readMotionNumber("--dissolve-blur", 18);
    const sway = readMotionNumber("--dissolve-sway", 14);
    const spin = readMotionNumber("--dissolve-spin", 8);
    const churn = readMotionNumber("--dissolve-churn", 70);
    const spread = readMotionNumber("--dissolve-spread", 25);
    const warpEase = sampleCssEasing(readStr("--dissolve-warp-ease"));
    const blurEase = sampleCssEasing(readStr("--dissolve-blur-ease"));
    const gravityEase = sampleCssEasing(readStr("--dissolve-gravity-ease"));
    const dissolveEase = sampleCssEasing(readStr("--dissolve-dissolve-ease"));
    try { prepare(warp / 2 + maxBlur * 2); }
    catch { running = false; onComplete?.(); return; }
    card.style.visibility = "hidden";
    const t0 = performance.now();
    let frame = 0;
    (function tick(now: number) {
      if (!running || destroyed) return;
      const t = (now - t0) / 1000;
      const rawP = Math.min((now - t0) / Math.max(durMs, 1), 1);
      const p = dissolveEase(rawP);
      const teff = gravityEase(p) * (durMs / 1000);
      const fallY = 0.5 * g * teff * teff;
      const swayX = Math.sin(t * 5) * sway * p;
      const pw = Math.min((now - t0) / Math.max(warpDurMs, 1), 1);
      const dispScale = warp * warpEase(pw);
      const blur = maxBlur * blurEase(p);
      const alpha = 1 - Math.pow(p, 1.6);
      const driftY = churn * t;
      const driftX = Math.sin(t * 3.2) * churn * 0.3;
      if (frame % 2 === 0 || rawP >= 1) {
        const halfDev = (dispScale / 2) * dpr;
        for (let ly = 0; ly < latH; ly++) {
          const py = (ly * LAT - padDev) / dpr;
          for (let lx = 0; lx < latW; lx++) {
            const px = (lx * LAT - padDev) / dpr;
            const li = ly * latW + lx;
            latDX[li] = halfDev * sampleNoise(noiseR, px - driftX, py - driftY, 28, 28);
            latDY[li] = halfDev * sampleNoise(noiseG, px - driftX, py - driftY, 28, 28);
          }
        }
        const rBox = blur > 0.3 ? Math.round(blur * dpr * 1.22) : 0;
        if (rBox >= 2) {
          remap(halfData.data, wW2, wH2, 2, false);
          const rHalf = Math.max(1, Math.round(rBox / 2));
          boxH(halfData.data, blurTmp, wW2, wH2, rHalf);
          boxH(blurTmp, halfData.data, wW2, wH2, rHalf);
          boxV(halfData.data, blurTmp, wW2, wH2, rHalf, false);
          boxV(blurTmp, halfData.data, wW2, wH2, rHalf, true);
          whctx.putImageData(halfData, 0, 0);
          ctx.clearRect(0, 0, workW, workH);
          ctx.drawImage(workHalf, 0, 0, wW2, wH2, 0, 0, workW, workH);
        } else {
          remap(workData.data, workW, workH, 1, true);
          ctx.putImageData(workData, 0, 0);
        }
      }
      frame++;
      canvas.style.transform =
        "translate(" +
        swayX.toFixed(1) +
        "px, " +
        fallY.toFixed(1) +
        "px)" +
        " rotate(" +
        (spin * p).toFixed(2) +
        "deg)" +
        " scale(" +
        (1 + (spread / 100) * p).toFixed(3) +
        ")";
      canvas.style.opacity = alpha.toFixed(3);

      if (rawP < 1) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.transform = "";
      canvas.style.opacity = "";
      frameId = null;
      onComplete?.();
      if (destroyed) return;
      respawnTimer = window.setTimeout(
        function () {
          if (destroyed) return;
          if (!respawn) {
            running = false;
            return;
          }
          card.style.visibility = "";
          card.classList.remove("is-respawning");
          card.offsetWidth;
          card.classList.add("is-respawning");
          running = false;
        },
        readMotionNumber("--dissolve-respawn", 800),
      );
    })(t0);
  }

  const reset = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    window.clearTimeout(respawnTimer);
    frameId = null;
    running = false;
    card.style.visibility = "";
    card.classList.remove("is-respawning");
    canvas.style.transform = "";
    canvas.style.opacity = "";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName === "oa-dissolve-respawn") card.classList.remove("is-respawning");
  };
  const onMotionChange = () => { if (media.matches) reset(); };
  const onVisibility = () => { if (document.hidden) reset(); };
  card.addEventListener("animationend", onAnimationEnd);
  media.addEventListener("change", onMotionChange);
  document.addEventListener("visibilitychange", onVisibility);
  return {
    dissolve,
    destroy: () => {
      destroyed = true;
      reset();
      card.removeEventListener("animationend", onAnimationEnd);
      media.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
