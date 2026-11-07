import fs from "fs"
import path from "path"
import { parseSummary, getAllDocHrefs } from "./parse-summary"
import type { DocsNavTree } from "./types"

export function getDocsNavTree(): DocsNavTree {
  const summaryPath = path.join(process.cwd(), "content/docs/SUMMARY.md")
  const content = fs.readFileSync(summaryPath, "utf-8")
  return parseSummary(content)
}

export { getAllDocHrefs }
export type { DocsNavTree }
