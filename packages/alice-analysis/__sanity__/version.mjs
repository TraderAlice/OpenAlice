// One-shot sanity check: import the freshly-built native module and assert
// that `version()` returns a non-empty string equal to the crate version.
// Delete after task #3 verification passes.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));
const expected = pkg.version;

const mod = await import(resolve(pkgRoot, 'index.js'));
const v = mod.version();

assert.equal(typeof v, 'string', `version() should return string, got ${typeof v}`);
assert.ok(v.length > 0, 'version() returned empty string');
assert.equal(v, expected, `version() returned ${v}, expected ${expected}`);

console.log(`OK: version() === ${JSON.stringify(v)}`);
