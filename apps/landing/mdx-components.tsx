import type { MDXComponents } from "mdx/types";

// Minimal passthrough — blog and docs each pass their own components
// via <Content components={...} /> at render time.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
