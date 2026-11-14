# Third-Party Notices

`antigravity-pulse` (`Model Pulse` / `agy-pulse`) is distributed under the [MIT License](LICENSE) (`Copyright (c) 2026 springtian <springtian@gmail.com>`).

---

## 1. Zero Runtime npm Dependencies & SPDX Bundle Headers

`antigravity-pulse` ships with **zero runtime `npm` dependencies** (`package.json` intentionally declares no `"dependencies"` field):

- All five git-tracked prebuilt runtime bundles (`dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, and `sidecars/pulse_cockpit/dist/ui.js`) execute exclusively against Node.js `>= 20` built-in modules (`node:fs`, `node:path`, `node:os`, `node:http`, `node:url`, `node:child_process`, `node:crypto` — explicitly excluded from `dist/hook-probe.cjs` per `D-010` — and optional `node:sqlite` via `process.getBuiltinModule('node:sqlite')` read-only `?mode=ro` fallback) and the host-provided Google Antigravity `sidecar_sdk` runtime (`external: ['sidecar_sdk']` in `server.mjs`).
- Every prebuilt bundle carries the explicit SPDX copyright banner:
  ```text
  /* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */
  ```
- The plugin brand emblem (`assets/logo.svg`) is an original MIT-licensed SVG authored specifically for `antigravity-pulse`.

---

## 2. Flexoki Color Scheme (Design Specification Palette)

- **Homepage**: <https://stephango.com/flexoki>
- **Author**: Steph Ango (`@kepano`)
- **License**: MIT License

`antigravity-pulse` adopts the Flexoki Light and Dark warm-paper / obsidian color palettes across `DESIGN.md`, `sidecars/pulse_cockpit/styles.css` (`/hud` `AUX_PANE` and `/fleet` `SIDEBAR`), terminal ANSI tier mappings, and `src/mcp/embed-card.ts` inline `<agent-embed>` telemetry cards:

```text
MIT License

Copyright (c) Steph Ango

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
```

---

## 3. Development-Only Build & Typecheck Toolchain (Not Distributed in Runtime Bundles)

Contributors working on the source repository (`npm install`) use the following `devDependencies` strictly for static typechecking (`tsc --noEmit`) and local bundle compilation (`scripts/build.mjs` / `scripts/build-tests.mjs`). None of their code is embedded into the shipped runtime bundles or copied by `scripts/install.mjs`:

| Package | Purpose (Contributor-Only) | Upstream License |
| :--- | :--- | :--- |
| [`esbuild`](https://github.com/evanw/esbuild) | Bundling TypeScript entrypoints into zero-dep `.cjs` / `.mjs` / `.js` files | MIT License |
| [`typescript`](https://github.com/microsoft/TypeScript) | Strict static type checking (`npm run typecheck`) | Apache License 2.0 |
| [`@types/node`](https://github.com/DefinitelyTyped/DefinitelyTyped) | Node.js built-in module TypeScript type definitions | MIT License |
