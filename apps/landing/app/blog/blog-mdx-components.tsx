import type { MDXComponents } from "mdx/types";
import Image from "next/image";
import { mediaUrl } from "@/lib/media";

export const blogMdxComponents: MDXComponents = {
  // MDX h1 renders as h2 (page already has h1 in header for SEO)
  h1: ({ children }) => (
    <h2 className="text-3xl font-bold mt-12 mb-6">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="text-2xl font-semibold mt-10 mb-4">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-xl font-semibold mt-8 mb-3">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-muted-foreground mb-4 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 mb-4 space-y-3 text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 mb-4 space-y-3 text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href ? mediaUrl(href) : href}
      data-evt="blog_article_link"
      data-location="blog_article"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground my-4">{children}</blockquote>
  ),
  code: ({ children }) => (
    <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-4">{children}</pre>
  ),
  del: ({ children }) => (
    <del className="text-muted-foreground/60 line-through">{children}</del>
  ),
  hr: () => (
    <hr className="my-8 border-border" />
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-6">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left py-3 px-4 font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="py-3 px-4 text-muted-foreground align-top">{children}</td>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-border/50">{children}</tr>
  ),
  img: (props) => {
    const { alt = "", src, ...imageProps } = props as React.ComponentProps<typeof Image>

    return (
      <Image
        alt={alt}
        sizes="100vw"
        style={{ width: "100%", height: "auto" }}
        className="rounded-lg my-6"
        src={typeof src === "string" ? mediaUrl(src) : src}
        {...imageProps}
      />
    )
  },
};
