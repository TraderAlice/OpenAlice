import assert from "node:assert/strict";
import test from "node:test";
import { createMediaResolver, mediaRemotePatterns, normalizeMediaBaseUrl } from "./media-runtime.mjs";
import rehypeMedia from "./rehype-media.mjs";

const sha256 = "1234567890abcdef".repeat(4);
const index = {
  schemaVersion: 1,
  assets: {
    "/pic/example.png": { contentType: "image/png", bytes: 100, sha256, width: 1200, height: 800 },
    "/pic/example.mp4": { contentType: "video/mp4", bytes: 200, sha256 },
  },
};

test("resolves indexed media below an optional prefix with content revision, preserving query and fragment", () => {
  const { mediaUrl, mediaImage } = createMediaResolver(index, "https://assets.example.test/website///");
  assert.equal(mediaUrl("/pic/example.mp4"), "https://assets.example.test/website/pic/example.mp4?v=1234567890ab");
  assert.equal(mediaUrl("/pic/example.png?download=1#preview"), "https://assets.example.test/website/pic/example.png?download=1&v=1234567890ab#preview");
  assert.deepEqual(mediaImage("/pic/example.png"), {
    src: "https://assets.example.test/website/pic/example.png?v=1234567890ab",
    width: 1200,
    height: 800,
  });
});

test("unconfigured preview keeps local paths but does not hide missing index entries", () => {
  const { mediaUrl } = createMediaResolver(index);
  assert.equal(mediaUrl("/pic/example.png"), "/pic/example.png");
  assert.equal(mediaUrl("/docs/getting-started/installation"), "/docs/getting-started/installation");
  assert.equal(mediaUrl("https://other.example.test/photo.png"), "https://other.example.test/photo.png");
  assert.equal(mediaUrl("data:image/png;base64,AA=="), "data:image/png;base64,AA==");
  assert.throws(() => mediaUrl("/pic/missing.png"), /Unindexed site media.*\/pic\/missing.png/);
});

test("invalid image metadata fails instead of reading public files or guessing dimensions", () => {
  const { mediaImage } = createMediaResolver(index);
  assert.throws(() => mediaImage("/pic/example.mp4"), /Missing image dimensions/);
  assert.throws(() => createMediaResolver({ ...index, schemaVersion: 2 }), /Unsupported public media index/);
  const corrupt = structuredClone(index);
  corrupt.assets["/pic/example.png"].sha256 = "unverified";
  assert.throws(() => createMediaResolver(corrupt).mediaUrl("/pic/example.png"), /Invalid media metadata/);
});

test("Next image permissions allow only the configured origin and prefix", () => {
  assert.deepEqual(mediaRemotePatterns(), []);
  assert.deepEqual(mediaRemotePatterns("https://assets.example.test:8443/website/"), [{
    protocol: "https",
    hostname: "assets.example.test",
    port: "8443",
    pathname: "/website/**",
  }]);
  for (const base of ["ftp://assets.example.test", "https://user:secret@assets.example.test", "https://assets.example.test/?key=secret", "https://*.example.test", "https://assets.example.test/#part"]) {
    assert.throws(() => normalizeMediaBaseUrl(base), /NEXT_PUBLIC_MEDIA_BASE_URL/);
  }
});

test("MDX dimensions and literal JSX media resolve without local media bytes", () => {
  const tree = {
    type: "root",
    children: [
      { type: "element", tagName: "img", properties: { src: "/pic/example.png", alt: "Example" } },
      { type: "mdxJsxFlowElement", name: "img", attributes: [
        { type: "mdxJsxAttribute", name: "src", value: "/pic/example.png" },
        { type: "mdxJsxAttribute", name: "className", value: "existing-style" },
      ] },
      { type: "mdxJsxFlowElement", name: "video", attributes: [
        { type: "mdxJsxAttribute", name: "src", value: "/pic/example.mp4" },
        { type: "mdxJsxAttribute", name: "poster", value: "/pic/example.png" },
      ] },
    ],
  };
  rehypeMedia({ index, baseUrl: "https://assets.example.test" })(tree);
  assert.equal(tree.children[0].properties.src, "/pic/example.png");
  assert.equal(tree.children[0].properties.width, 1200);
  const attributes = Object.fromEntries(tree.children[1].attributes.map(({ name, value }) => [name, value]));
  assert.equal(attributes.src, "https://assets.example.test/pic/example.png?v=1234567890ab");
  assert.equal(attributes.width, "1200");
  assert.equal(attributes.height, "800");
  assert.equal(attributes.className, "existing-style");
  assert.equal(tree.children[2].attributes[1].value, attributes.src);
  assert.throws(() => rehypeMedia({ index })({
    type: "element", tagName: "img", properties: { src: "/pic/missing.png" },
  }), /Unindexed site media/);
});
