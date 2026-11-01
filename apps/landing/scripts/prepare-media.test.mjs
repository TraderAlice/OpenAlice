import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMedia } from "./prepare-media.mjs";

const baseUrl = "https://media.example.test/website";
const index = {
  schemaVersion: 1, baseUrl,
  assets: { "/pic/demo.png": {
    contentType: "image/png", bytes: 10, sha256: "ab".repeat(32), width: 640, height: 480,
  } },
};

test("prepares only the public index and refreshes it without fetching media", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "landing-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, ".cache/media-index.json");
  const requests = [];
  let current = index;
  const fetchImpl = async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, "error");
    return Response.json(current);
  };
  await prepareMedia({ baseUrl, outputPath, fetchImpl });
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), index);
  current = structuredClone(index);
  current.assets["/pic/second.png"] = index.assets["/pic/demo.png"];
  await prepareMedia({ baseUrl, outputPath, fetchImpl });
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), current);
  assert.deepEqual(requests, [`${baseUrl}/index.json`, `${baseUrl}/index.json`]);
});

test("unavailable or invalid indexes fail and preserve the last complete cache", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "landing-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "index.json");
  await prepareMedia({ baseUrl, outputPath, fetchImpl: async () => Response.json(index) });
  const before = await readFile(outputPath, "utf8");
  const malformed = [
    { ...index, schemaVersion: 2 }, { ...index, baseUrl: "https://other.example.test" },
    { ...index, assets: {} }, { ...index, assets: { "/../escape.png": index.assets["/pic/demo.png"] } },
    { ...index, assets: { "/pic/demo.png": { ...index.assets["/pic/demo.png"], width: 0 } } },
  ];
  for (const value of malformed) {
    await assert.rejects(prepareMedia({ baseUrl, outputPath, fetchImpl: async () => Response.json(value) }));
  }
  await assert.rejects(prepareMedia({ baseUrl, outputPath, fetchImpl: async () => new Response("Unavailable", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(prepareMedia({ baseUrl, outputPath, fetchImpl: async () => { throw new Error("offline"); } }), /offline/);
  assert.equal(await readFile(outputPath, "utf8"), before);
});
