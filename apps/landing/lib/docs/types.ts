/** A clickable page link: * [Title](path.mdx) */
export interface DocsNavPage {
  kind: "page"
  title: string
  href: string
  filePath: string
  children: DocsNavPage[]
}

/** A draft page with empty href: * [Draft]() */
export interface DocsNavDraft {
  kind: "draft"
  title: string
}

/** An external link: * [External](https://...) */
export interface DocsNavExternal {
  kind: "external"
  title: string
  href: string
}

/** A visual separator: --- */
export interface DocsNavSeparator {
  kind: "separator"
}

/** A section group: ## Heading */
export interface DocsNavGroup {
  kind: "group"
  title: string
  items: DocsNavItem[]
}

/** Any item that can appear inside a group or as an ungrouped prefix */
export type DocsNavItem =
  | DocsNavPage
  | DocsNavDraft
  | DocsNavExternal
  | DocsNavSeparator

/** Top-level element: either a group or an ungrouped item */
export type DocsNavEntry = DocsNavGroup | DocsNavItem

/** The full parsed navigation tree */
export interface DocsNavTree {
  entries: DocsNavEntry[]
}
