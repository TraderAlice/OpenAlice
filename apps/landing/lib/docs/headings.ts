import fs from "fs"
import { resolveDocFilePath } from "./navigation"

export interface DocsHeading {
  id: string
  text: string
  level: 2 | 3
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/&/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
}

export function readDocSource(slugPath: string): string | null {
  const resolved = resolveDocFilePath(slugPath)
  if (!resolved) return null
  return fs.readFileSync(resolved, "utf8")
}

export function getDocHeadings(slugPath: string): DocsHeading[] {
  const source = readDocSource(slugPath)
  if (!source) return []

  const headings: DocsHeading[] = []
  let inFence = false

  for (const line of source.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }

    if (inFence) continue

    const match = /^(#{2,3})\s+(.+)$/.exec(line)
    if (!match) continue

    const text = stripMarkdown(match[2])
    if (!text) continue

    headings.push({
      id: slugifyHeading(text),
      text,
      level: match[1].length as 2 | 3,
    })
  }

  return headings
}
