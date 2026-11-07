"use client"

import Link from "next/link"
import { SearchIcon } from "lucide-react"
import { DocsMobileNav } from "./docs-mobile-nav"
import type { DocsNavTree } from "@/lib/docs/types"

export function DocsHeader({
  tree,
  onSearchOpen,
}: {
  tree: DocsNavTree
  onSearchOpen: () => void
}) {
  return (
    <header className="docs-header">
      <div className="docs-header-content">
        <div className="docs-header-left">
          <Link
            href="/"
            data-evt="docs_header_home"
            data-target="home"
            data-location="nav"
            className="docs-header-logo"
          >
            OpenAlice
          </Link>
          <Link
            href="/docs"
            data-evt="docs_header_docs"
            data-target="docs"
            data-location="nav"
            className="docs-header-badge"
          >
            Docs
          </Link>
        </div>
        <div className="docs-header-right">
          <DocsMobileNav tree={tree} />
          <button
            className="docs-header-search"
            aria-label="Search docs"
            onClick={onSearchOpen}
            data-evt="docs_search_open"
            data-target="docs_search"
            data-location="nav"
          >
            <SearchIcon className="docs-header-search-icon" />
            <span className="docs-header-search-text">Search docs...</span>
            <kbd className="docs-header-search-kbd">⌘K</kbd>
          </button>
          <a
            href="https://github.com/TraderAlice/OpenAlice"
            target="_blank"
            rel="noopener"
            data-evt="docs_header_github"
            data-target="github_repo"
            data-location="nav"
            className="docs-header-link"
          >
            GitHub
          </a>
          <Link
            href="/blog"
            data-evt="docs_header_blog"
            data-target="blog"
            data-location="nav"
            className="docs-header-link"
          >
            Blog
          </Link>
        </div>
      </div>
    </header>
  )
}
