"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const palettes = [
  {
    id: "classic",
    name: "Classic",
    swatches: ["#8F745A", "#2F2924", "#DED2C0"],
  },
  {
    id: "paper",
    name: "Paper",
    swatches: ["#786552", "#302B26", "#E5DCCF"],
  },
  {
    id: "graphite",
    name: "Graphite",
    swatches: ["#1F2020", "#343331", "#E4DFD6"],
  },
  {
    id: "sage",
    name: "Sage",
    swatches: ["#54665B", "#30332F", "#DCE4D8"],
  },
  {
    id: "blush",
    name: "Blush",
    swatches: ["#A26862", "#4D4741", "#EBDAD3"],
  },
];

const storageKey = "openalice-palette";

function applyPalette(id: string) {
  document.documentElement.dataset.palette = id;
  window.localStorage.setItem(storageKey, id);

  const nextUrl = new URL(window.location.href);
  if (id === "classic") {
    nextUrl.searchParams.delete("palette");
  } else {
    nextUrl.searchParams.set("palette", id);
  }
  window.history.replaceState(null, "", nextUrl);
}

export function PaletteSwitcher() {
  const pathname = usePathname();
  const docsRoute = pathname.startsWith("/docs");
  const [active, setActive] = useState("classic");
  const [mobileOpen, setMobileOpen] = useState(false);
  const activePalette =
    palettes.find((palette) => palette.id === active) ?? palettes[0];

  useEffect(() => {
    if (docsRoute) return;

    const params = new URLSearchParams(window.location.search);
    const requested = params.get("palette") ?? window.localStorage.getItem(storageKey);
    const initial = requested && palettes.some((palette) => palette.id === requested)
      ? requested
      : "classic";

    document.documentElement.dataset.palette = initial;
    const frame = window.requestAnimationFrame(() => setActive(initial));
    return () => window.cancelAnimationFrame(frame);
  }, [docsRoute]);

  if (pathname === "/" || docsRoute) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[70] sm:bottom-4 sm:right-4">
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="palette-options"
        onClick={() => setMobileOpen((open) => !open)}
        className="flex items-center gap-2 rounded-full border border-border/70 bg-background/92 px-3 py-2 text-xs font-medium text-foreground/78 shadow-[0_14px_34px_-20px_rgba(42,37,33,0.58)] backdrop-blur-md sm:hidden"
      >
        <span className="flex overflow-hidden rounded-full border border-foreground/15">
          {activePalette.swatches.map((color) => (
            <span
              key={color}
              className="h-3.5 w-3.5"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <span>Palette</span>
      </button>

      <div
        id="palette-options"
        className={`${mobileOpen ? "block" : "hidden"} absolute bottom-full right-0 mb-2 w-[min(21rem,calc(100vw-1.5rem))] rounded-[14px] border border-border/70 bg-background/92 p-2 shadow-[0_18px_50px_-24px_rgba(42,37,33,0.55)] backdrop-blur-md sm:static sm:block sm:w-auto`}
      >
        <div className="mb-1.5 px-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
          Palette
        </div>
        <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-col">
          {palettes.map((palette) => (
            <button
              key={palette.id}
              type="button"
              aria-pressed={active === palette.id}
              onClick={() => {
                applyPalette(palette.id);
                setActive(palette.id);
                setMobileOpen(false);
              }}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground/75 transition-colors hover:bg-foreground/5 aria-pressed:bg-foreground aria-pressed:text-background"
            >
              <span className="flex shrink-0 overflow-hidden rounded-full border border-foreground/15">
                {palette.swatches.map((color) => (
                  <span
                    key={color}
                    className="h-4 w-4"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="truncate">{palette.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
