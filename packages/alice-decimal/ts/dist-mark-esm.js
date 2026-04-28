// Drop a `package.json` into ts/dist marking the directory as ESM. The root
// package's `package.json` deliberately does NOT have `"type": "module"`
// because the napi-rs generated `index.js` (sibling of this package's root)
// uses CommonJS `require()` calls and Node would refuse to load it as ESM.
// Same pattern as alice-analysis — keep them in lockstep.

const fs = require('fs')
const path = require('path')

const out = path.resolve(__dirname, 'dist', 'package.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ type: 'module' }, null, 2) + '\n')
console.log('wrote', out)
