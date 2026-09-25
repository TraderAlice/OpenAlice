/**
 * Runtime shim replacing the bundled `abort-controller` polyfill with Node's
 * native global implementations.
 *
 * grammY's Node shim imports `abort-controller` because it supports old Node
 * runtimes. Our connector bundle externalizes nothing, so esbuild would inline
 * that polyfill. esbuild renames its `AbortSignal` class to avoid a collision
 * with the native global, and node-fetch v2 (v2.7.0) gates every request on
 * the signal prototype's constructor name being exactly "AbortSignal". The
 * renamed class no longer matches, so every grammY HTTP call fails with
 * "Expected signal to be an instanceof AbortSignal".
 *
 * Rather than ship a legacy polyfill (the runtime is Node >= 22), alias
 * `abort-controller` to this module so grammY hands node-fetch the native
 * `AbortSignal`, whose constructor keeps its real name.
 */
export const AbortController = globalThis.AbortController
export const AbortSignal = globalThis.AbortSignal
export default globalThis.AbortController
