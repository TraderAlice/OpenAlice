import { useId, type CSSProperties } from "react";
import "./shimmer-tile.css";
export function ShimmerTile({
  width = 142,
  height = 142,
  radius = 12,
  playing = true,
}: { width?: number; height?: number; radius?: number; playing?: boolean }) {
  const filterId = `oa-shimmer-warp-${useId().replace(/:/g, "")}`;
  const scale = Math.min(width, height) / 142;
  return (
    <>
      <div
        className="oa-shimmer-tile"
        aria-hidden
        data-playing={playing ? undefined : "false"}
        style={
          {
            width,
            height,
            borderRadius: radius,
            "--shimmer-scale": scale,
            "--shimmer-warp": `url(#${filterId})`,
          } as CSSProperties
        }
      >
        <span className="oa-shimmer"><span className="oa-shimmer-band" /></span>
        <span className="oa-shimmer-edge">
          <span className="oa-shimmer-edge-bloom" />
          <span className="oa-shimmer-edge-glow" />
          <span className="oa-shimmer-edge-ring" />
        </span>
      </div>
      <ShimmerWarpFilter id={filterId} />
    </>
  );
}

function ShimmerWarpFilter({ id }: { id: string }) {
  return (
    <svg
      width={0}
      height={0}
      style={{ position: "absolute" }}
      aria-hidden
      focusable="false"
    >
      <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.009 0.015"
          numOctaves={2}
          seed={7}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale={46}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
