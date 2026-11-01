"use client";

import Link from "next/link";
import {
  type FocusEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from "react";

type MobileNavProps = {
  versionLabel: string;
  landing?: boolean;
};

export function MobileNav({ versionLabel, landing = false }: MobileNavProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  function closeMenu(returnFocus = false) {
    const details = detailsRef.current;
    if (!details) return;

    details.open = false;
    setIsOpen(false);

    if (returnFocus) {
      details.querySelector<HTMLElement>("summary")?.focus();
    }
  }

  function handleBlur(event: FocusEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      closeMenu();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !detailsRef.current?.open) return;

    event.preventDefault();
    closeMenu(true);
  }

  return (
    <details
      ref={detailsRef}
      className="oa-mobile-nav md:hidden"
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onToggle={() => setIsOpen(detailsRef.current?.open ?? false)}
    >
      <summary
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={isOpen}
      >
        <span aria-hidden />
        <span aria-hidden />
        <span aria-hidden />
      </summary>
      <div className="oa-mobile-nav-panel">
        <Link
          href="/docs"
          data-evt="nav_mobile_docs"
          data-target="docs"
          data-location="nav"
          onClick={() => closeMenu()}
        >
          <span>01</span>
          Docs
        </Link>
        {!landing && (
          <Link
            href="/blog"
            data-evt="nav_mobile_journal"
            data-target="blog"
            data-location="nav"
            onClick={() => closeMenu()}
          >
            <span>02</span>
            Journal
          </Link>
        )}
        <a
          href="https://github.com/TraderAlice/OpenAlice"
          target="_blank"
          rel="noopener"
          data-evt="nav_mobile_github"
          data-target="github_repo"
          data-location="nav"
          onClick={() => closeMenu()}
        >
          <span>{landing ? "02" : "03"}</span>
          GitHub
        </a>
        <Link
          href="/download"
          data-evt="nav_mobile_install"
          data-target="download"
          data-location="nav"
          onClick={() => closeMenu()}
        >
          <span>{landing ? "03" : "04"}</span>
          Install OpenAlice
        </Link>
        <p>{versionLabel} · Self-hosted</p>
      </div>
    </details>
  );
}
