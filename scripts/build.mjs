#!/usr/bin/env node
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SPDX_BANNER =
  '/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */';

async function buildAll() {
  mkdirSync(path.join(REPO_ROOT, 'dist'), { recursive: true });
  mkdirSync(path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist'), { recursive: true });

  await Promise.all([
    esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'hook', 'hook-probe.ts')],
      outfile: path.join(REPO_ROOT, 'dist', 'hook-probe.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      minify: false,
      sourcemap: false,
      banner: { js: SPDX_BANNER },
    }),
    esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'mcp', 'server.ts')],
      outfile: path.join(REPO_ROOT, 'dist', 'mcp.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      minify: false,
      sourcemap: false,
      banner: { js: `#!/usr/bin/env node\n${SPDX_BANNER}` },
    }),
    esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'cli', 'main.ts')],
      outfile: path.join(REPO_ROOT, 'dist', 'cli.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      minify: false,
      sourcemap: false,
      banner: { js: `#!/usr/bin/env node\n${SPDX_BANNER}` },
    }),
    esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'sidecar', 'server.ts')],
      outfile: path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist', 'server.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      external: ['sidecar_sdk'],
      minify: false,
      sourcemap: false,
      banner: { js: SPDX_BANNER },
    }),
    esbuild.build({
      entryPoints: [path.join(REPO_ROOT, 'src', 'ui', 'main.ts')],
      outfile: path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist', 'ui.js'),
      bundle: true,
      platform: 'browser',
      target: 'es2022',
      format: 'iife',
      minify: false,
      sourcemap: false,
      banner: { js: SPDX_BANNER },
    }),
  ]);

  if (process.platform !== 'win32') {
    chmodSync(path.join(REPO_ROOT, 'dist', 'cli.cjs'), 0o755);
    chmodSync(path.join(REPO_ROOT, 'dist', 'mcp.cjs'), 0o755);
  }

  console.log('[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/');
}

buildAll().catch((err) => {
  console.error('[build] Failed:', err);
  process.exit(1);
});
