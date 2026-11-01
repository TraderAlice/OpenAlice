import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { mediaRemotePatterns, normalizeMediaBaseUrl } from "./lib/media-runtime.mjs";
import rehypeMedia from "./lib/rehype-media.mjs";
import { DEFAULT_MEDIA_BASE_URL, prepareMedia } from "./scripts/prepare-media.mjs";

export default async function config(phase: string) {
  const baseUrl = normalizeMediaBaseUrl(process.env.NEXT_PUBLIC_MEDIA_BASE_URL || DEFAULT_MEDIA_BASE_URL);
  // Refresh only the small index, before Next compiles either server or client code.
  // Serving an existing build does not require another request to the media store.
  const mediaIndex = [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD].includes(phase)
    ? await prepareMedia({ baseUrl })
    : { schemaVersion: 1, assets: {} };

  const nextConfig: NextConfig = {
    pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
    images: {
      remotePatterns: mediaRemotePatterns(baseUrl),
    },
    async redirects() {
      return [{ source: "/live", destination: "/", permanent: false }];
    },
  };

  const withMDX = createMDX({
    options: {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [[rehypeMedia, { index: mediaIndex, baseUrl }], rehypeSlug],
    },
  });

  return withMDX(nextConfig);
}
