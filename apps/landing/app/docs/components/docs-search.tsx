"use client"

import { useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { FileTextIcon } from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import type {
  DocsNavTree,
  DocsNavItem,
  DocsNavPage,
} from "@/lib/docs/types"

function collectPages(tree: DocsNavTree): DocsNavPage[] {
  const pages: DocsNavPage[] = []

  function fromPage(page: DocsNavPage) {
    pages.push(page)
    for (const child of page.children) fromPage(child)
  }

  function fromItems(items: DocsNavItem[]) {
    for (const item of items) {
      if (item.kind === "page") fromPage(item)
    }
  }

  for (const entry of tree.entries) {
    if (entry.kind === "group") fromItems(entry.items)
    else if (entry.kind === "page") fromPage(entry)
  }

  return pages
}

export function DocsSearch({
  tree,
  open,
  onOpenChange,
}: {
  tree: DocsNavTree
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const pages = collectPages(tree)

  // ⌘K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  const onSelect = useCallback(
    (href: string) => {
      onOpenChange(false)
      router.push(href)
    },
    [router, onOpenChange],
  )

  return (
    <CommandDialog
      className="oa-docs-portal"
      open={open}
      onOpenChange={onOpenChange}
      title="Search Documentation"
      description="Search for a page in the docs"
    >
      <CommandInput placeholder="Search docs..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((page) => (
            <CommandItem
              key={page.href}
              value={page.title}
              data-evt="docs_search_select"
              data-target="docs"
              data-location="docs_search"
              data-href={page.href}
              onSelect={() => onSelect(page.href)}
            >
              <FileTextIcon />
              <span>{page.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
