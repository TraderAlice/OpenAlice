import type { MediaIndex } from "./media-runtime.mjs";

export default function rehypeMedia(options: {
  index: MediaIndex;
  baseUrl?: string;
}): (tree: unknown) => void;
