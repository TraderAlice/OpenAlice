"use client";

import Image from "next/image";
import { useCoordinatedDemoPlayback } from "@/app/hooks/useCoordinatedDemoPlayback";
import { mediaImage, mediaUrl } from "@/lib/media";

type ProductDemoProps = {
  src: string;
  poster: string;
  title: string;
  children?: React.ReactNode;
};

export function ProductDemo({ src, poster, title, children }: ProductDemoProps) {
  const { containerRef, videoRef, shouldRenderVideo } =
    useCoordinatedDemoPlayback<HTMLElement>({
      restartKey: src,
      minVisibleRatio: 0.4,
    });

  return (
    <figure ref={containerRef} className="docs-product-demo">
      <div className="docs-product-demo-bar">
        <span><i /> Product walkthrough</span>
        <strong>{title}</strong>
      </div>
      {shouldRenderVideo ? (
        <video
          ref={videoRef}
          src={mediaUrl(src)}
          poster={mediaUrl(poster)}
          muted
          loop
          playsInline
          controls
          preload="metadata"
          aria-label={title}
        />
      ) : (
        <Image
          {...mediaImage(poster)}
          alt={title}
          loading="eager"
          sizes="(max-width: 767px) calc(100vw - 2rem), 840px"
        />
      )}
      {children ? <figcaption>{children}</figcaption> : null}
    </figure>
  );
}
