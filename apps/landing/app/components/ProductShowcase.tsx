"use client";

import Image from "next/image";
import { type KeyboardEvent, useState } from "react";
import { useCoordinatedDemoPlayback } from "@/app/hooks/useCoordinatedDemoPlayback";
import { mediaImage, mediaUrl } from "@/lib/media";

const views = [
  {
    analyticsId: "agent",
    label: "Launch an agent",
    path: "/pic/product-ask-alice-webpi-260825.mp4",
    poster: "/pic/product-ask-alice-webpi-260825.jpg",
    breadcrumb: "ask alice / pi session / webpi",
    caption: "Give your agent the brief.",
    alt: "Ask Alice launching a real Pi research Session, then opening the same Session in WebPi to review its three-step plan",
  },
  {
    analyticsId: "automation",
    label: "Schedule the work",
    path: "/pic/product-issue-report-demo-260825.mp4",
    poster: "/pic/product-issue-report-demo-260825.jpg",
    breadcrumb: "issues / runs / inbox report",
    caption: "Turn the plan into recurring work.",
    alt: "OpenAlice following a scheduled Issue through its run history into the published Inbox report",
  },
  {
    analyticsId: "linked_reports",
    label: "Publish linked reports",
    path: "/pic/product-linked-report-graph-demo-260825.mp4",
    poster: "/pic/product-linked-report-graph-demo-260825.jpg",
    breadcrumb: "tracked / linked reports / graph",
    caption: "Every result keeps its evidence.",
    alt: "OpenAlice opening one of twelve reports linked to an AI infrastructure topic, then revealing the topic and its source network in Graph view",
  },
] as const;

export function ProductShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [progress, setProgress] = useState(0);
  const active = views[activeIndex];
  const { containerRef, videoRef, shouldRenderVideo } =
    useCoordinatedDemoPlayback<HTMLDivElement>({
      restartKey: active.path,
      minVisibleRatio: 0.4,
    });

  function selectDemo(nextIndex: number, source: "auto" | "manual") {
    if (source === "manual") setAutoAdvance(false);
    if (nextIndex === activeIndex) return;
    setProgress(0);
    setActiveIndex(nextIndex);
    window.dispatchEvent(new CustomEvent("openalice:product-demo-select", {
      detail: {
        demoGroup: "hero",
        demoId: views[nextIndex].analyticsId,
        source,
      },
    }));
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % views.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + views.length) % views.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = views.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    selectDemo(nextIndex, "manual");
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus();
  }

  return (
    <>
      <div
        className="oa-showcase-tabs"
        role="tablist"
        aria-label="OpenAlice product highlights"
      >
        {views.map((view, index) => (
          <button
            key={view.path}
            id={`showcase-tab-${view.analyticsId}`}
            type="button"
            role="tab"
            aria-selected={activeIndex === index}
            aria-controls="showcase-panel"
            tabIndex={activeIndex === index ? 0 : -1}
            data-demo-select
            data-demo-id={view.analyticsId}
            data-demo-location="hero"
            className={activeIndex === index ? "is-active" : undefined}
            onClick={() => selectDemo(index, "manual")}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <span>{view.label}</span>
            <i
              aria-hidden
              style={{
                transform: `scaleX(${activeIndex === index ? progress : 0})`,
              }}
            />
          </button>
        ))}
      </div>

      <div className="oa-showcase-caption" aria-live="polite">
        <div>
          <p>
            <span>0{activeIndex + 1}</span>
            {active.breadcrumb}
          </p>
          <strong>{active.caption}</strong>
        </div>
        {shouldRenderVideo ? (
          <button
            type="button"
            onClick={() => setAutoAdvance((current) => !current)}
            aria-label={autoAdvance ? "Pause automatic demo sequence" : "Play automatic demo sequence"}
          >
            {autoAdvance ? "Pause sequence" : "Play sequence"}
          </button>
        ) : null}
      </div>

      <div
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${active.analyticsId}`}
        className="oa-showcase-wrap"
      >
        <div
          ref={containerRef}
          className="oa-product-stage"
          data-demo-stage
          data-demo-id={active.analyticsId}
          data-demo-location="hero"
        >
          <div className="oa-product-shot" key={active.path}>
            {shouldRenderVideo ? (
              <video
                ref={videoRef}
                src={mediaUrl(active.path)}
                poster={mediaUrl(active.poster)}
                muted
                loop={!autoAdvance}
                playsInline
                preload="metadata"
                aria-label={active.alt}
                data-demo-id={active.analyticsId}
                data-demo-location="hero"
                className="h-full w-full object-contain"
                onLoadedMetadata={() => setProgress(0)}
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
                  setProgress(Math.min(video.currentTime / video.duration, 1));
                }}
                onEnded={() => {
                  if (!autoAdvance) return;
                  selectDemo((activeIndex + 1) % views.length, "auto");
                }}
              />
            ) : (
              <Image
                {...mediaImage(active.poster)}
                alt={active.alt}
                sizes="(max-width: 767px) calc(100vw - 2rem), 1280px"
                className="h-full w-full object-contain"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
