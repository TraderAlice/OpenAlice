"use client"

import { useEffect, useMemo, useState } from "react"
import type { DocsHeading } from "@/lib/docs/headings"

export function DocsToc({ headings }: { headings: DocsHeading[] }) {
  const [activeId, setActiveId] = useState(headings[0]?.id ?? "")
  const headingIds = useMemo(() => headings.map((heading) => heading.id), [headings])

  useEffect(() => {
    if (headingIds.length === 0) return

    const elements = headingIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el))

    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible[0]?.target.id) setActiveId(visible[0].target.id)
      },
      {
        rootMargin: "-96px 0px -68% 0px",
        threshold: [0, 1],
      },
    )

    elements.forEach((element) => observer.observe(element))

    return () => observer.disconnect()
  }, [headingIds])

  if (headings.length === 0) return null

  return (
    <aside className="docs-toc" aria-label="On this page">
      <div className="docs-toc-inner">
        <p className="docs-toc-title">On this page</p>
        <nav>
          {headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              data-evt="docs_toc_link"
              data-target="docs_heading"
              data-location="docs_toc"
              onClick={() => setActiveId(heading.id)}
              className={[
                "docs-toc-link",
                heading.level === 3 ? "docs-toc-link-nested" : "",
                activeId === heading.id ? "docs-toc-link-active" : "",
              ].filter(Boolean).join(" ")}
            >
              {heading.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  )
}
