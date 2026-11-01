"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type PlaybackEntry = {
  id: string;
  element: HTMLElement;
  video: HTMLVideoElement | null;
  ratio: number;
  minVisibleRatio: number;
  canPlay: boolean;
  restartKey: string;
  lastStartedKey: string | null;
  pendingKey: string | null;
  generation: number;
};

type DemoPlaybackOptions = {
  restartKey: string;
  narrowQuery?: string;
  minVisibleRatio?: number;
};

const entries = new Map<string, PlaybackEntry>();
let elementIds = new WeakMap<Element, string>();
let observer: IntersectionObserver | null = null;
let activeId: string | null = null;
let electionQueued = false;
let listeningForVisibility = false;

const thresholds = Array.from({ length: 101 }, (_, index) => index / 100);

function pauseEntry(entry: PlaybackEntry | undefined) {
  if (!entry) return;
  entry.generation += 1;
  entry.pendingKey = null;
  entry.video?.pause();
}

function startEntry(entry: PlaybackEntry) {
  const video = entry.video;
  if (!video || document.hidden) return;

  entry.generation += 1;
  const generation = entry.generation;
  const pendingKey = entry.restartKey;
  entry.pendingKey = pendingKey;
  video.currentTime = 0;

  void video.play().then(() => {
    if (
      activeId !== entry.id ||
      entry.generation !== generation ||
      entry.video !== video ||
      document.hidden
    ) {
      video.pause();
      return;
    }
    entry.pendingKey = null;
    entry.lastStartedKey = pendingKey;
  }).catch(() => {
    if (entry.generation === generation && entry.pendingKey === pendingKey) {
      entry.pendingKey = null;
    }
  });
}

function activate(nextId: string | null) {
  if (nextId === activeId) {
    const current = nextId ? entries.get(nextId) : undefined;
    if (
      current &&
      current.lastStartedKey !== current.restartKey &&
      current.pendingKey !== current.restartKey
    ) {
      startEntry(current);
    }
    return;
  }

  pauseEntry(activeId ? entries.get(activeId) : undefined);
  activeId = nextId;
  if (nextId) {
    const next = entries.get(nextId);
    if (next) startEntry(next);
  }
}

function distanceFromViewportCenter(entry: PlaybackEntry) {
  const rect = entry.element.getBoundingClientRect();
  return Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
}

function electMostVisible() {
  if (document.hidden) {
    activate(null);
    return;
  }

  const candidates = [...entries.values()].filter(
    (entry) =>
      entry.canPlay &&
      entry.video?.isConnected &&
      entry.ratio >= entry.minVisibleRatio,
  );

  if (candidates.length === 0) {
    activate(null);
    return;
  }

  candidates.sort((a, b) =>
    b.ratio - a.ratio ||
    distanceFromViewportCenter(a) - distanceFromViewportCenter(b) ||
    a.id.localeCompare(b.id),
  );

  const leader = candidates[0];
  const current = activeId
    ? candidates.find((candidate) => candidate.id === activeId)
    : undefined;
  activate(
    current && leader.ratio - current.ratio <= 0.025
      ? current.id
      : leader.id,
  );
}

function queueElection() {
  if (electionQueued) return;
  electionQueued = true;
  queueMicrotask(() => {
    electionQueued = false;
    electMostVisible();
  });
}

function onVisibilityChange() {
  if (document.hidden) activate(null);
  else queueElection();
}

function ensureCoordinator() {
  if (!observer) {
    observer = new IntersectionObserver(
      (observed) => {
        for (const item of observed) {
          const id = elementIds.get(item.target);
          const entry = id ? entries.get(id) : undefined;
          if (entry) entry.ratio = item.isIntersecting ? item.intersectionRatio : 0;
        }
        queueElection();
      },
      { threshold: thresholds },
    );
  }

  if (!listeningForVisibility) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    listeningForVisibility = true;
  }
}

function teardownCoordinatorIfIdle() {
  if (entries.size > 0) return;
  observer?.disconnect();
  observer = null;
  elementIds = new WeakMap<Element, string>();
  activeId = null;
  if (listeningForVisibility) {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    listeningForVisibility = false;
  }
}

export function useCoordinatedDemoPlayback<T extends HTMLElement>({
  restartKey,
  narrowQuery = "(max-width: 767px)",
  minVisibleRatio = 0.08,
}: DemoPlaybackOptions) {
  const id = useId();
  const containerRef = useRef<T>(null);
  const [shouldRenderVideo, setShouldRenderVideo] = useState(false);

  const videoRef = useCallback((video: HTMLVideoElement | null) => {
    const entry = entries.get(id);
    if (!entry || entry.video === video) return;

    pauseEntry(entry);
    entry.video = video;
    entry.lastStartedKey = null;
    queueElection();
  }, [id]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrowViewport = narrowQuery ? window.matchMedia(narrowQuery) : null;
    const update = () => {
      setShouldRenderVideo(!reducedMotion.matches && !narrowViewport?.matches);
    };

    update();
    reducedMotion.addEventListener("change", update);
    narrowViewport?.addEventListener("change", update);
    return () => {
      reducedMotion.removeEventListener("change", update);
      narrowViewport?.removeEventListener("change", update);
    };
  }, [narrowQuery]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    ensureCoordinator();
    const entry: PlaybackEntry = {
      id,
      element,
      video: null,
      ratio: 0,
      minVisibleRatio,
      canPlay: false,
      restartKey: "",
      lastStartedKey: null,
      pendingKey: null,
      generation: 0,
    };
    entries.set(id, entry);
    elementIds.set(element, id);
    observer?.observe(element);

    return () => {
      observer?.unobserve(element);
      pauseEntry(entry);
      entries.delete(id);
      if (activeId === id) activeId = null;
      queueElection();
      teardownCoordinatorIfIdle();
    };
  }, [id, minVisibleRatio]);

  useEffect(() => {
    const entry = entries.get(id);
    if (!entry) return;

    entry.restartKey = restartKey;
    entry.canPlay = shouldRenderVideo;
    if (!shouldRenderVideo) pauseEntry(entry);
    queueElection();
  }, [id, restartKey, shouldRenderVideo]);

  return { containerRef, videoRef, shouldRenderVideo };
}
