import fs from "fs"
import path from "path"
import { parseSummary, getAllDocHrefs } from "./parse-summary"
import type { DocsNavTree } from "./types"

export function getDocsRoot(): string {
  const fromLanding = path.resolve(process.cwd(), "../../docs")
  if (fs.existsSync(path.join(fromLanding, "SUMMARY.md"))) {
    return fromLanding
  }
  return path.resolve(process.cwd(), "docs")
}

export function resolveDocFilePath(slugPath: string): string | null {
  const docsRoot = getDocsRoot()
  const candidates = [
    path.join(docsRoot, "guides", `${slugPath}.md`),
    path.join(docsRoot, "architecture", `${slugPath}.md`),
    path.join(docsRoot, `${slugPath}.md`),
    path.join(docsRoot, "guides", slugPath, "README.md"),
    path.join(docsRoot, "architecture", slugPath, "README.md"),
    path.join(docsRoot, slugPath, "README.md"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

export function getDocsNavTree(): DocsNavTree {
  const summaryPath = path.join(getDocsRoot(), "SUMMARY.md")
  const content = fs.readFileSync(summaryPath, "utf-8")
  return parseSummary(content)
}

export { getAllDocHrefs }
export type { DocsNavTree }
