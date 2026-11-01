"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { MenuIcon } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { DocsNavList } from "./docs-sidebar"
import type { DocsNavTree } from "@/lib/docs/types"

export function DocsMobileNav({ tree }: { tree: DocsNavTree }) {
  const [open, setOpen] = useState(false)
  const currentPath = usePathname()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="docs-header-icon-button docs-header-menu"
          aria-label="Browse docs"
          type="button"
          data-evt="docs_mobile_nav_open"
          data-target="docs_nav"
          data-location="nav"
        >
          <MenuIcon aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="oa-docs-portal docs-mobile-nav-sheet">
        <SheetHeader>
          <SheetTitle>Docs</SheetTitle>
          <SheetDescription>Browse OpenAlice documentation.</SheetDescription>
        </SheetHeader>
        <div className="docs-mobile-nav-scroll">
          <DocsNavList
            tree={tree}
            currentPath={currentPath}
            location="docs_mobile_nav"
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
