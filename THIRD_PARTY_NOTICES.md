# Third-Party Notices

## stablyai/orca terminal patches and keyboard policy

`patches/@xterm__addon-webgl@0.20.0-beta.286.patch` is adapted from
[`stablyai/orca`](https://github.com/stablyai/orca) commit
`1b331f282cd4da880b888f242e3545fffbba4cb5`.

`patches/@xterm__xterm@6.1.0-beta.287.patch`, the focused keyboard shortcut,
Kitty keyboard / IME
modules in `ui/src/components/workspace/terminal-*.ts` and
`ui/src/components/workspace/xterm-bypass-policy.ts`, and the macOS input-source
probe in `apps/desktop/src/keyboard-input-source.ts` are adapted from
[`stablyai/orca`](https://github.com/stablyai/orca) commit
`ab0f220c60739c90ecbedd327d0b4619e715570d`.

`patches/@xterm__addon-serialize@0.15.0-beta.287.patch`, the headless terminal
snapshot implementation in `src/workspaces/`, and the inherited terminal
color-environment sanitization in `src/workspaces/spawn-env.ts` are adapted
from the same Orca commit.

MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
