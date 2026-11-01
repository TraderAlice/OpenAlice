import { createMediaResolver } from "./media-runtime.mjs";

/** Read dimensions from the checked-in index, never from public/ media bytes. */
export default function rehypeMedia({ index, baseUrl = "" }) {
  const { mediaUrl, mediaImage } = createMediaResolver(index, baseUrl);

  function imageDimensions(src) {
    if (typeof src !== "string" || !src.startsWith("/") || src.startsWith("//")) return {};
    const { width, height } = mediaImage(src);
    return { width, height };
  }

  return function transform(tree) {
    function visit(node) {
      if (node.type === "element" && node.tagName === "img") {
        Object.assign(node.properties, imageDimensions(node.properties.src));
      }
      // Literal JSX tags bypass MDX's components map. Resolve those attributes
      // during compilation while keeping the authored MDX paths unchanged.
      if (["mdxJsxFlowElement", "mdxJsxTextElement"].includes(node.type) && ["img", "video", "source"].includes(node.name)) {
        const source = node.attributes?.find((attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "src");
        if (node.name === "img" && typeof source?.value === "string") {
          for (const [name, value] of Object.entries(imageDimensions(source.value))) {
            if (!node.attributes.some((attribute) => attribute.name === name)) {
              node.attributes.push({ type: "mdxJsxAttribute", name, value: String(value) });
            }
          }
        }
        for (const attribute of node.attributes ?? []) {
          if (attribute.type === "mdxJsxAttribute" && ["src", "poster"].includes(attribute.name) && typeof attribute.value === "string") {
            attribute.value = mediaUrl(attribute.value);
          }
        }
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
