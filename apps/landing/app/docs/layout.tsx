import { DocsSidebar } from "./components/docs-sidebar"
import { DocsShell } from "./components/docs-shell"
import { getDocsNavTree } from "@/lib/docs/navigation"
import "./docs.css"

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const tree = getDocsNavTree()

  return (
    <div className="oa-docs">
      <DocsShell tree={tree}>
        <div className="docs-container">
          <DocsSidebar tree={tree} />
          <main className="docs-content">
            {children}
          </main>
        </div>
      </DocsShell>
    </div>
  )
}
