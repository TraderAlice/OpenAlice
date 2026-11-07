import { permanentRedirect } from "next/navigation"
import { getDocsNavTree, getAllDocHrefs } from "@/lib/docs/navigation"
import { getDocHeadings } from "@/lib/docs/headings"
import { docsMdxComponents } from "@/app/docs/docs-mdx-components"
import { DocsToc } from "@/app/docs/components/docs-toc"
import { DocsReleaseStatus } from "@/app/docs/components/docs-release-status"
import type { DocsPageMetadata } from "@/lib/docs/release-channel"
import type { MDXProps } from "mdx/types"
import type { Metadata } from "next"
import { SOCIAL_IMAGE } from "@/app/lib/site"

interface PageProps {
  params: Promise<{ slug: string[] }>
}

export async function generateStaticParams() {
  const tree = getDocsNavTree()
  const hrefs = getAllDocHrefs(tree)
  return hrefs.map((href) => ({
    slug: href.replace(/^\/docs\//, "").split("/"),
  }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const slugPath = slug.join("/")

  try {
    const { metadata } = await import(`@/content/docs/${slugPath}.mdx`)
    const title = `${metadata.title} - OpenAlice Docs`
    const description = metadata.description
    const url = `/docs/${slugPath}`
    return {
      title,
      description,
      alternates: { canonical: url },
      openGraph: {
        title,
        description,
        url,
        type: "article",
        images: [SOCIAL_IMAGE],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [SOCIAL_IMAGE.url],
      },
    }
  } catch {
    return { title: "OpenAlice Docs" }
  }
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params
  const slugPath = slug.join("/")
  const headings = getDocHeadings(slugPath)

  let Content: React.ComponentType<MDXProps>
  let metadata: DocsPageMetadata

  // Try direct path first, then README fallback
  try {
    const mod = await import(`@/content/docs/${slugPath}.mdx`)
    Content = mod.default
    metadata = mod.metadata
  } catch {
    try {
      const mod = await import(`@/content/docs/${slugPath}/README.mdx`)
      Content = mod.default
      metadata = mod.metadata
    } catch {
      permanentRedirect("/docs")
    }
  }

  return (
    <div className="docs-article-layout">
      <article className="docs-article" data-section="docs_article">
        <DocsReleaseStatus metadata={metadata} />
        <Content components={docsMdxComponents} />
      </article>
      <DocsToc headings={headings} />
    </div>
  )
}
