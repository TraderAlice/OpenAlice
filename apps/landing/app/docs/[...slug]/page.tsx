import { permanentRedirect } from "next/navigation"
import * as runtime from "react/jsx-runtime"
import { evaluate } from "@mdx-js/mdx"
import remarkGfm from "remark-gfm"
import rehypeSlug from "rehype-slug"
import { getDocsNavTree, getAllDocHrefs } from "@/lib/docs/navigation"
import { getDocHeadings, readDocSource } from "@/lib/docs/headings"
import { docsMdxComponents } from "@/app/docs/docs-mdx-components"
import { DocsToc } from "@/app/docs/components/docs-toc"
import { DocsReleaseStatus } from "@/app/docs/components/docs-release-status"
import type { DocsPageMetadata } from "@/lib/docs/release-channel"
import type { Metadata } from "next"
import { SOCIAL_IMAGE } from "@/app/lib/site"
import mediaIndex from "@/.cache/media-index.json"
import rehypeMedia from "@/lib/rehype-media.mjs"

interface PageProps {
  params: Promise<{ slug: string[] }>
}

function parseFrontmatter(raw: string): {
  data: Record<string, string>
  content: string
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return { data: {}, content: raw }
  }
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/)
    if (!kv) continue
    const key = kv[1]
    const rawVal = kv[2].trim()
    try {
      data[key] =
        (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
        (rawVal.startsWith("'") && rawVal.endsWith("'"))
          ? JSON.parse(rawVal.startsWith("'") ? `"${rawVal.slice(1, -1).replace(/"/g, '\\"')}"` : rawVal)
          : rawVal
    } catch {
      data[key] = rawVal.replace(/^['"]|['"]$/g, "")
    }
  }
  return { data, content: raw.slice(match[0].length) }
}

function preprocessDocMarkdown(raw: string): {
  metadata: DocsPageMetadata
  markdown: string
} {
  const parsed = parseFrontmatter(raw)
  let body = parsed.content

  // Extract fallback title/description from Markdown when frontmatter is absent
  const headingMatch = body.match(/^#\s+(.+)$/m)
  const fallbackTitle = headingMatch ? headingMatch[1].replace(/[`*_~]/g, "").trim() : "OpenAlice Docs"

  const metadata: DocsPageMetadata = {
    title: typeof parsed.data.title === "string" ? parsed.data.title : fallbackTitle,
    description: typeof parsed.data.description === "string" ? parsed.data.description : fallbackTitle,
    releaseChannel: parsed.data.releaseChannel as DocsPageMetadata["releaseChannel"],
    targetVersion: parsed.data.targetVersion,
  }

  // Transform <ProductDemo ...>caption</ProductDemo> into a pure Markdown code block
  body = body.replace(
    /<ProductDemo\s+([\s\S]*?)>([\s\S]*?)<\/ProductDemo>/g,
    (_full, attrsRaw: string, captionRaw: string) => {
      const getAttr = (name: string) => {
        const m = attrsRaw.match(new RegExp(`${name}=["']([^"']+)["']`))
        return m ? m[1] : ""
      }
      const payload = {
        src: getAttr("src"),
        poster: getAttr("poster"),
        title: getAttr("title"),
        caption: captionRaw.trim().replace(/\s+/g, " "),
      }
      return `\n\`\`\`product-demo\n${JSON.stringify(payload)}\n\`\`\`\n`
    }
  )

  // Convert repo-internal [[docs/...]] wikilinks into clickable docs routes
  body = body.replace(/\[\[docs\/(?:architecture\/|guides\/)?([^\].]+)(?:\.md)?\]\]/g, (_m, slug: string) => {
    if (slug === "README") return "[`docs/README.md`](/docs)"
    if (slug === "remote-quickstart") return `[${slug}](/docs/${slug})`
    return `[${slug}](/docs/architecture/${slug})`
  })

  return { metadata, markdown: body }
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
  const raw = readDocSource(slugPath)
  if (!raw) {
    return { title: "OpenAlice Docs" }
  }

  const { metadata } = preprocessDocMarkdown(raw)
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
}

export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params
  const slugPath = slug.join("/")
  const raw = readDocSource(slugPath)
  if (!raw) {
    permanentRedirect("/docs")
  }

  const headings = getDocHeadings(slugPath)
  const { metadata, markdown } = preprocessDocMarkdown(raw)

  const { default: Content } = await evaluate(markdown, {
    ...(runtime as Parameters<typeof evaluate>[1]),
    format: "md",
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypeMedia, { index: mediaIndex, baseUrl: mediaIndex.baseUrl }], rehypeSlug],
  })

  return (
    <div className="docs-article-layout">
      <article className="docs-article">
        <DocsReleaseStatus metadata={metadata} />
        <Content components={docsMdxComponents} />
      </article>
      <DocsToc headings={headings} />
    </div>
  )
}
