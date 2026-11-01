import type { MDXComponents } from "mdx/types";
import Image from "next/image";
import { ProductDemo } from "@/app/docs/components/ProductDemo";
import { mediaUrl } from "@/lib/media";

// Drizzle-inspired docs typography — compact spacing, clear hierarchy.
// Colors use our CSS variables, not hardcoded values.
export const docsMdxComponents: MDXComponents = {
  ProductDemo,
  h1: ({ id, children }) => (
    <h1 id={id} className="text-[32px] font-bold tracking-[-0.015em] py-1 scroll-mt-24">{children}</h1>
  ),
  h2: ({ id, children }) => (
    <h2 id={id} className="text-[24px] font-semibold tracking-[-0.015em] mt-8 py-[3px] scroll-mt-24">{children}</h2>
  ),
  h3: ({ id, children }) => (
    <h3 id={id} className="text-[20px] font-semibold tracking-[-0.015em] mt-8 mb-px py-[3px] scroll-mt-24">{children}</h3>
  ),
  h4: ({ id, children }) => (
    <h4 id={id} className="text-[20px] font-semibold tracking-[-0.015em] mt-4 mb-px py-[3px] scroll-mt-24">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="leading-[1.5em] py-[6px]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="docs-list docs-list-unordered">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="docs-list docs-list-ordered">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="docs-list-item">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href ? mediaUrl(href) : href}
      data-evt="docs_article_link"
      data-target={href?.startsWith("#") ? "docs_heading" : undefined}
      data-location="docs_article"
      className="docs-article-link rounded underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground/70"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="docs-quote">{children}</blockquote>
  ),
  code: ({ children, className }) => {
    if (className?.startsWith("language-")) {
      return <code className={className}>{children}</code>
    }

    return (
      <code className="docs-inline-code">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="docs-code-block">{children}</pre>
  ),
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  hr: () => (
    <hr className="border-t border-border my-0" />
  ),
  table: ({ children }) => (
    <div className="docs-table-wrap">
      <table className="docs-table">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead>{children}</thead>
  ),
  th: ({ children }) => (
    <th className="docs-table-heading">{children}</th>
  ),
  td: ({ children }) => (
    <td className="docs-table-cell">{children}</td>
  ),
  tr: ({ children }) => (
    <tr>{children}</tr>
  ),
  img: (props) => {
    const {
      alt = "",
      title,
      className,
      src,
      ...imageProps
    } = props as React.ComponentProps<typeof Image> & { title?: string }
    const displayMode = title === "small" || title === "medium" || title === "wide" || title === "full" ? title : "default"
    const frameClassName = [
      "docs-image-frame",
      displayMode !== "default" ? `docs-image-frame-${displayMode}` : "",
    ].filter(Boolean).join(" ")
    const imageClassName = [
      "docs-image",
      displayMode !== "default" ? `docs-image-${displayMode}` : "",
      className,
    ].filter(Boolean).join(" ")
    const resolvedSrc = typeof src === "string" ? mediaUrl(src) : src
    const linkHref = typeof resolvedSrc === "string" ? resolvedSrc : undefined

    const sizes = {
      default: "(max-width: 768px) 100vw, 720px",
      small: "(max-width: 768px) 100vw, 440px",
      medium: "(max-width: 768px) 100vw, 720px",
      wide: "(max-width: 768px) 100vw, 960px",
      full: "(max-width: 768px) 100vw, 1180px",
    }[displayMode]

    return (
      <a
        href={linkHref}
        data-evt={linkHref ? "docs_article_image" : undefined}
        data-target={linkHref ? "docs_image" : undefined}
        data-location={linkHref ? "docs_article" : undefined}
        className={frameClassName}
      >
        <Image
          alt={alt}
          sizes={sizes}
          className={imageClassName}
          src={resolvedSrc}
          {...imageProps}
        />
      </a>
    )
  },
};
