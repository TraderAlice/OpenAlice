"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@vercel/analytics";

const ATTRIBUTION_KEY = "oa_initial_attribution";
const ATTRIBUTION_TRACKED_KEY = "oa_initial_attribution_tracked";
const MAX_PARAM_LENGTH = 160;

type Attribution = {
  initial_referrer_host: string;
  initial_referrer_path: string;
  landing_host: string;
  landing_path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  has_gclid: string;
  has_fbclid: string;
};

type EventData = Record<string, string>;

function analyticsReady() {
  return typeof window !== "undefined" && typeof window.va === "function";
}

function trackWhenReady(name: string, data: EventData, attempt = 0) {
  if (analyticsReady()) {
    track(name, data);
    return;
  }

  if (attempt >= 30) return;
  window.setTimeout(() => trackWhenReady(name, data, attempt + 1), 100);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function readStoredAttribution() {
  try {
    const saved = sessionStorage.getItem(ATTRIBUTION_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function writeStoredAttribution(attribution: Attribution) {
  try {
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch {
    // Storage may be unavailable in private browsing or embedded webviews.
  }
}

function getParam(params: URLSearchParams, key: string) {
  return truncate(params.get(key) || "", MAX_PARAM_LENGTH);
}

function storedString(saved: Record<string, unknown>, key: string) {
  return typeof saved[key] === "string"
    ? truncate(saved[key], MAX_PARAM_LENGTH)
    : "";
}

function normalizeStoredAttribution(saved: Record<string, unknown>): Attribution {
  return {
    initial_referrer_host: storedString(saved, "initial_referrer_host"),
    initial_referrer_path: storedString(saved, "initial_referrer_path"),
    landing_host: storedString(saved, "landing_host"),
    landing_path: storedString(saved, "landing_path"),
    utm_source: storedString(saved, "utm_source"),
    utm_medium: storedString(saved, "utm_medium"),
    utm_campaign: storedString(saved, "utm_campaign"),
    utm_content: storedString(saved, "utm_content"),
    utm_term: storedString(saved, "utm_term"),
    has_gclid:
      saved.has_gclid === "true" || Boolean(saved.gclid) ? "true" : "false",
    has_fbclid:
      saved.has_fbclid === "true" || Boolean(saved.fbclid) ? "true" : "false",
  };
}

function createAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  let referrerHost = "";
  let referrerPath = "";

  if (document.referrer) {
    try {
      const parsed = new URL(document.referrer);
      referrerHost = parsed.hostname;
      referrerPath = parsed.pathname;
    } catch {
      referrerHost = "";
      referrerPath = "";
    }
  }

  return {
    initial_referrer_host: referrerHost,
    initial_referrer_path: truncate(referrerPath, MAX_PARAM_LENGTH),
    landing_host: window.location.hostname,
    landing_path: truncate(window.location.pathname, MAX_PARAM_LENGTH),
    utm_source: getParam(params, "utm_source"),
    utm_medium: getParam(params, "utm_medium"),
    utm_campaign: getParam(params, "utm_campaign"),
    utm_content: getParam(params, "utm_content"),
    utm_term: getParam(params, "utm_term"),
    has_gclid: params.has("gclid") ? "true" : "false",
    has_fbclid: params.has("fbclid") ? "true" : "false",
  };
}

function getInitialAttribution() {
  const saved = readStoredAttribution();
  if (saved) {
    const attribution = normalizeStoredAttribution(saved);
    writeStoredAttribution(attribution);
    return attribution;
  }

  const attribution = createAttribution();
  writeStoredAttribution(attribution);
  return attribution;
}

function getHrefParts(el: HTMLElement) {
  const href =
    el.getAttribute("href") ||
    el.dataset.href ||
    el.closest("a")?.getAttribute("href") ||
    "";
  if (!href) {
    return {
      href_host: "",
      href_path: "",
      href_outbound: "false",
    };
  }

  try {
    const url = new URL(href, window.location.origin);
    return {
      href_host: url.hostname,
      href_path: truncate(url.pathname, MAX_PARAM_LENGTH),
      href_outbound: url.hostname === window.location.hostname ? "false" : "true",
    };
  } catch {
    return {
      href_host: "",
      href_path: "",
      href_outbound: "unknown",
    };
  }
}

function inferTarget(id: string, hrefHost: string, hrefPath: string) {
  if (hrefHost === "github.com") {
    if (hrefPath.includes("/releases")) return "github_release";
    return "github_repo";
  }
  if (hrefHost === "download.openalice.ai") {
    if (hrefPath.endsWith(".dmg")) return "mac_download";
    if (hrefPath.endsWith(".exe")) return "windows_download";
    if (hrefPath.endsWith(".zip")) return "mac_zip_download";
    return "download";
  }
  if (hrefHost === "demo.openalice.ai") return "demo";
  if (hrefHost === "discord.gg" || hrefHost === "discord.com") return "discord";
  if (hrefHost === "traderhub.openalice.ai") return "traderhub";
  if (hrefHost === "localhost" || hrefHost === "127.0.0.1" || hrefHost === "[::1]") {
    return "local_app";
  }
  if (hrefHost === window.location.hostname && hrefPath === "/") return "home";
  if (hrefHost === window.location.hostname && hrefPath === "/download") {
    return "download";
  }
  if (hrefHost === window.location.hostname && hrefPath === "/docs/getting-started/installation") {
    return "install_guide";
  }
  if (hrefHost === window.location.hostname && hrefPath.startsWith("/docs")) return "docs";
  if (hrefHost === window.location.hostname && hrefPath.startsWith("/blog")) return "blog";
  if (id.includes("docs")) return "docs";
  if (id.includes("demo")) return "demo";
  if (id.includes("discord")) return "discord";
  if (id.includes("github") || id.includes("clone") || id.includes("get")) return "github_repo";
  return "unknown";
}

function inferLocation(id: string, el: HTMLElement) {
  const explicit = el.dataset.location;
  if (explicit) return explicit;
  const section = el.closest<HTMLElement>("[data-section]")?.dataset.section;
  if (id.startsWith("nav_")) return "nav";
  if (id.startsWith("hero_")) return "hero";
  if (id.startsWith("final_")) return "final";
  if (id.startsWith("footer_")) return "footer";
  return section ? "section" : "unknown";
}

function compactAttributionEventData(attribution: Partial<Attribution>) {
  return {
    ref_host: attribution.initial_referrer_host || "",
    ref_path: attribution.initial_referrer_path || "",
    landing_path: attribution.landing_path || "",
    landing_host: attribution.landing_host || "",
    utm_src: attribution.utm_source || "",
    utm_med: attribution.utm_medium || "",
    utm_cmp: attribution.utm_campaign || "",
    utm_content: attribution.utm_content || "",
    utm_term: attribution.utm_term || "",
    has_gclid: attribution.has_gclid || "false",
    has_fbclid: attribution.has_fbclid || "false",
  };
}

function compactPageContextEventData() {
  return {
    current_path: truncate(window.location.pathname, MAX_PARAM_LENGTH),
    device: window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
  };
}

function elementEventData(el: HTMLElement) {
  return {
    link_text: truncate((el.textContent || "").replace(/\s+/g, " ").trim(), MAX_PARAM_LENGTH),
    element_tag: el.tagName.toLowerCase(),
  };
}

function createClickId(id: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}_${id}_${random}`;
}

/**
 * Funnel instrumentation for the landing page (Vercel Analytics custom events).
 *
 *  - `section_view` — fired once when a `[data-section]` block first scrolls into
 *    the upper 65% of the viewport. Gives a comparable drop-off funnel even
 *    when a section is taller than a small screen.
 *  - `cta_click` — fired on any `[data-evt]` click, carrying the stable funnel
 *    fields only. Extra context is split into `cta_href`, `cta_attr`, and
 *    `cta_element` to stay within Vercel Web Analytics custom-data limits.
 *  - `product_demo_*` — records which product story was seen, selected, played,
 *    and reached the 50% / 90% playback milestones.
 *  - `landing_attribution` — fired once per session with referrer host/path and
 *    landing UTM context, so non-click visits still have source detail.
 */
export function PageAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    const attribution = getInitialAttribution();

    try {
      if (!sessionStorage.getItem(ATTRIBUTION_TRACKED_KEY)) {
        trackWhenReady("attribution", compactAttributionEventData(attribution));
        trackWhenReady("landing_attribution", {
          ...compactAttributionEventData(attribution),
          ...compactPageContextEventData(),
        });
        sessionStorage.setItem(ATTRIBUTION_TRACKED_KEY, "1");
      }
    } catch {
      trackWhenReady("attribution", compactAttributionEventData(attribution));
      trackWhenReady("landing_attribution", {
        ...compactAttributionEventData(attribution),
        ...compactPageContextEventData(),
      });
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>("[data-evt]");
      const id = el?.dataset.evt;
      if (!el || !id) return;
      const hrefParts = getHrefParts(el);
      const ctaTarget =
        el.dataset.target || inferTarget(id, hrefParts.href_host, hrefParts.href_path);
      const ctaLocation = inferLocation(id, el);
      const clickId = createClickId(id);
      const pageContext = compactPageContextEventData();
      const attribution = compactAttributionEventData(getInitialAttribution());
      const element = elementEventData(el);

      trackWhenReady("cta_click", {
        click_id: clickId,
        id,
        cta_target: ctaTarget,
        cta_location: ctaLocation,
        current_path: pageContext.current_path,
        device: pageContext.device,
      });

      trackWhenReady("cta_href", {
        click_id: clickId,
        id,
        href_host: hrefParts.href_host,
        href_path: hrefParts.href_path,
        href_outbound: hrefParts.href_outbound,
      });

      trackWhenReady("cta_attr", {
        click_id: clickId,
        id,
        ref_host: attribution.ref_host,
        ref_path: attribution.ref_path,
        landing_path: attribution.landing_path,
        landing_host: attribution.landing_host,
        utm_src: attribution.utm_src,
        utm_cmp: attribution.utm_cmp,
      });

      trackWhenReady("cta_element", {
        click_id: clickId,
        id,
        link_text: element.link_text,
        element_tag: element.element_tag,
      });
    };
    document.addEventListener("click", onClick, true);

    const seenDemos = new Set<string>();
    const trackDemoView = (demoGroup: string, demoId: string) => {
      const key = `${demoGroup}:${demoId}`;
      if (seenDemos.has(key)) return;
      seenDemos.add(key);
      const media =
        window.matchMedia("(max-width: 767px)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "poster"
          : "video";
      trackWhenReady("product_demo_view", {
        demo_group: demoGroup,
        demo_id: demoId,
        media,
        ...compactPageContextEventData(),
      });
    };

    const onDemoSelect = (event: Event) => {
      const detail = (event as CustomEvent<{
        demoGroup?: unknown;
        demoId?: unknown;
        source?: unknown;
      }>).detail;
      if (
        typeof detail?.demoGroup !== "string" ||
        typeof detail.demoId !== "string"
      ) return;

      trackWhenReady("product_demo_select", {
        demo_group: truncate(detail.demoGroup, MAX_PARAM_LENGTH),
        demo_id: truncate(detail.demoId, MAX_PARAM_LENGTH),
        selection_source:
          detail.source === "auto" || detail.source === "manual"
            ? detail.source
            : "manual",
        ...compactPageContextEventData(),
      });
      trackDemoView(
        truncate(detail.demoGroup, MAX_PARAM_LENGTH),
        truncate(detail.demoId, MAX_PARAM_LENGTH),
      );
    };
    window.addEventListener("openalice:product-demo-select", onDemoSelect);

    const played = new Set<string>();
    const progress = new Set<string>();
    const onMediaPlay = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      const demoId = video.dataset.demoId;
      const demoGroup = video.dataset.demoLocation;
      if (!demoId || !demoGroup) return;
      const key = `${demoGroup}:${demoId}`;
      if (played.has(key)) return;
      played.add(key);
      trackWhenReady("product_demo_play", {
        demo_group: demoGroup,
        demo_id: demoId,
        ...compactPageContextEventData(),
      });
    };
    const onMediaProgress = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) return;
      const demoId = video.dataset.demoId;
      const demoGroup = video.dataset.demoLocation;
      if (!demoId || !demoGroup || video.duration <= 0) return;
      const ratio = video.currentTime / video.duration;
      for (const milestone of [0.5, 0.9] as const) {
        const key = `${demoGroup}:${demoId}:${milestone}`;
        if (ratio < milestone || progress.has(key)) continue;
        progress.add(key);
        trackWhenReady("product_demo_progress", {
          demo_group: demoGroup,
          demo_id: demoId,
          milestone: String(Math.round(milestone * 100)),
          ...compactPageContextEventData(),
        });
      }
    };
    document.addEventListener("play", onMediaPlay, true);
    document.addEventListener("timeupdate", onMediaProgress, true);

    const seen = new Set<string>();
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const name = (entry.target as HTMLElement).dataset.section;
          if (entry.isIntersecting && name && !seen.has(name)) {
            seen.add(name);
            trackWhenReady("section_view", {
              name,
              ...compactPageContextEventData(),
              ...compactAttributionEventData(getInitialAttribution()),
            });
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px -35% 0px" },
    );
    document
      .querySelectorAll<HTMLElement>("[data-section]")
      .forEach((el) => sectionObserver.observe(el));

    const demoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const stage = entry.target as HTMLElement;
          const demoId = stage.dataset.demoId;
          const demoGroup = stage.dataset.demoLocation;
          if (!demoId || !demoGroup) continue;
          trackDemoView(demoGroup, demoId);
        }
      },
      { threshold: 0, rootMargin: "0px 0px -35% 0px" },
    );
    document
      .querySelectorAll<HTMLElement>("[data-demo-stage]")
      .forEach((el) => demoObserver.observe(el));

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("openalice:product-demo-select", onDemoSelect);
      document.removeEventListener("play", onMediaPlay, true);
      document.removeEventListener("timeupdate", onMediaProgress, true);
      sectionObserver.disconnect();
      demoObserver.disconnect();
    };
  }, [pathname]);

  return null;
}
