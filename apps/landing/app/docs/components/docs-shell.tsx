"use client"

import { useState } from "react"
import { DocsHeader } from "./docs-header"
import { DocsSearch } from "./docs-search"
import type { DocsNavTree } from "@/lib/docs/types"

export function DocsShell({
  tree,
  children,
}: {
  tree: DocsNavTree
  children: React.ReactNode
}) {
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <>
      <DocsHeader tree={tree} onSearchOpen={() => setSearchOpen(true)} />
      <DocsSearch tree={tree} open={searchOpen} onOpenChange={setSearchOpen} />
      {children}
    </>
  )
}
