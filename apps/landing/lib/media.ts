import mediaIndex from "@/.cache/media-index.json";
import { createMediaResolver } from "./media-runtime.mjs";

// Next prepares this ignored public index before compiling server and client bundles.
export const { mediaUrl, mediaMetadata, mediaImage } = createMediaResolver(
  mediaIndex,
  mediaIndex.baseUrl,
);
