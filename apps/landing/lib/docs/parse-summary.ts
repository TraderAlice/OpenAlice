import type {
  DocsNavTree,
  DocsNavEntry,
  DocsNavItem,
  DocsNavPage,
  DocsNavGroup,
} from "./types"

const RE_TITLE = /^# /
const RE_GROUP = /^## (.+)$/
const RE_SEPARATOR = /^---\s*$/
const RE_LINK = /^(\s*)[*-]\s+\[([^\]]*)\]\(([^)]*)\)\s*$/

function filePathToHref(filePath: string): string {
  const href = filePath
    .replace(/\.(mdx?|md)$/, "")
    .replace(/\/README$/, "")
  return "/docs/" + href
}

export function parseSummary(markdown: string): DocsNavTree {
  const lines = markdown.split("\n")
  const entries: DocsNavEntry[] = []
  let currentGroup: DocsNavGroup | null = null
  let pageStack: DocsNavPage[] = []
  let indentSize: number | null = null

  function pushItem(item: DocsNavItem) {
    if (currentGroup) {
      currentGroup.items.push(item)
    } else {
      entries.push(item)
    }
  }

  function flushGroup() {
    if (currentGroup) {
      entries.push(currentGroup)
      currentGroup = null
    }
    pageStack = []
  }

  for (const line of lines) {
    // Skip blank lines
    if (line.trim() === "") continue

    // Skip decorative title
    if (RE_TITLE.test(line)) continue

    // Group heading
    const groupMatch = line.match(RE_GROUP)
    if (groupMatch) {
      flushGroup()
      currentGroup = { kind: "group", title: groupMatch[1].trim(), items: [] }
      continue
    }

    // Separator
    if (RE_SEPARATOR.test(line)) {
      pageStack = []
      pushItem({ kind: "separator" })
      continue
    }

    // Link item
    const linkMatch = line.match(RE_LINK)
    if (linkMatch) {
      const [, indent, title, rawHref] = linkMatch

      // Detect indent unit from first indented line
      if (indent.length > 0 && indentSize === null) {
        indentSize = indent.length
      }
      const depth = indent.length > 0 && indentSize ? Math.floor(indent.length / indentSize) : 0

      // Classify the link
      if (rawHref === "") {
        // Draft
        pageStack = []
        pushItem({ kind: "draft", title })
      } else if (rawHref.startsWith("http://") || rawHref.startsWith("https://")) {
        // External
        pageStack = []
        pushItem({ kind: "external", title, href: rawHref })
      } else {
        // Page
        const page: DocsNavPage = {
          kind: "page",
          title,
          href: filePathToHref(rawHref),
          filePath: rawHref,
          children: [],
        }

        if (depth === 0) {
          pageStack = [page]
          pushItem(page)
        } else {
          // Pop stack back to parent depth
          while (pageStack.length > depth) {
            pageStack.pop()
          }
          if (pageStack.length > 0) {
            pageStack[pageStack.length - 1].children.push(page)
          } else {
            // Fallback: treat as top-level if stack is empty
            pushItem(page)
          }
          pageStack.push(page)
        }
      }
      continue
    }
  }

  // Flush remaining group
  flushGroup()

  return { entries }
}

/** Recursively collect all page hrefs for generateStaticParams */
export function getAllDocHrefs(tree: DocsNavTree): string[] {
  const hrefs: string[] = []

  function collectFromPage(page: DocsNavPage) {
    hrefs.push(page.href)
    for (const child of page.children) {
      collectFromPage(child)
    }
  }

  function collectFromItems(items: DocsNavItem[]) {
    for (const item of items) {
      if (item.kind === "page") {
        collectFromPage(item)
      }
    }
  }

  for (const entry of tree.entries) {
    if (entry.kind === "group") {
      collectFromItems(entry.items)
    } else if (entry.kind === "page") {
      collectFromPage(entry)
    }
  }

  return hrefs
}
