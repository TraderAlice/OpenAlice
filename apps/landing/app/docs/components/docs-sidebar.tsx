"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ExternalLink } from "lucide-react"
import type {
  DocsNavTree,
  DocsNavEntry,
  DocsNavItem,
  DocsNavPage,
} from "@/lib/docs/types"

function isPageActive(page: DocsNavPage, currentPath: string): boolean {
  if (currentPath === page.href) return true
  return page.children.some((child) => isPageActive(child, currentPath))
}

function NavPage({
  page,
  currentPath,
  location = "docs_sidebar",
  onNavigate,
  depth = 1,
}: {
  page: DocsNavPage
  currentPath: string
  location?: string
  onNavigate?: () => void
  depth?: number
}) {
  const isActive = currentPath === page.href
  const hasChildren = page.children.length > 0
  const isOpen = hasChildren && (depth === 1 || isPageActive(page, currentPath))
  const depthClass = depth >= 2 ? ` docs-nav-item-${depth}` : ""
  const activeClass = isActive ? " docs-nav-item--active" : ""

  return (
    <>
      <Link
        href={page.href}
        data-evt="docs_sidebar_link"
        data-target="docs"
        data-location={location}
        className={`docs-nav-item${depthClass}${activeClass}`}
        onClick={onNavigate}
      >
        {page.title}
      </Link>
      {hasChildren && isOpen &&
        page.children.map((child) => (
          <NavPage
            key={child.href}
            page={child}
            currentPath={currentPath}
            location={location}
            onNavigate={onNavigate}
            depth={depth + 1}
          />
        ))}
    </>
  )
}

function NavItem({
  item,
  currentPath,
  location = "docs_sidebar",
  onNavigate,
}: {
  item: DocsNavItem
  currentPath: string
  location?: string
  onNavigate?: () => void
}) {
  switch (item.kind) {
    case "page":
      return (
        <NavPage
          page={item}
          currentPath={currentPath}
          location={location}
          onNavigate={onNavigate}
        />
      )
    case "draft":
      return <span className="docs-nav-draft">{item.title}</span>
    case "external":
      return (
        <a
          href={item.href}
          target="_blank"
          rel="noopener"
          data-evt="docs_sidebar_external"
          data-location={location}
          className="docs-nav-external"
          onClick={onNavigate}
        >
          {item.title}
          <ExternalLink />
        </a>
      )
    case "separator":
      return null
  }
}

function NavEntry({
  entry,
  currentPath,
  location = "docs_sidebar",
  onNavigate,
}: {
  entry: DocsNavEntry
  currentPath: string
  location?: string
  onNavigate?: () => void
}) {
  if (entry.kind === "group") {
    return (
      <>
        <div className="docs-nav-separator">{entry.title}</div>
        <div className="docs-nav-items">
          {entry.items.map((item, i) => (
            <NavItem
              key={
                item.kind === "separator"
                  ? `sep-${i}`
                  : item.kind === "page" || item.kind === "external"
                    ? item.href
                    : `item-${i}`
              }
              item={item}
              currentPath={currentPath}
              location={location}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <NavItem
      item={entry}
      currentPath={currentPath}
      location={location}
      onNavigate={onNavigate}
    />
  )
}

export function DocsNavList({
  tree,
  currentPath,
  location = "docs_sidebar",
  onNavigate,
}: {
  tree: DocsNavTree
  currentPath: string
  location?: string
  onNavigate?: () => void
}) {
  return (
    <>
      {tree.entries.map((entry, i) => (
        <NavEntry
          key={entry.kind === "group" ? entry.title : `entry-${i}`}
          entry={entry}
          currentPath={currentPath}
          location={location}
          onNavigate={onNavigate}
        />
      ))}
    </>
  )
}

export function DocsSidebar({ tree }: { tree: DocsNavTree }) {
  const currentPath = usePathname()

  return (
    <aside className="docs-aside">
      <div className="docs-aside-scroll">
        <DocsNavList tree={tree} currentPath={currentPath} />
      </div>
    </aside>
  )
}
