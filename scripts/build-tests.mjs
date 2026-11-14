#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const TEST_DIST_DIR = path.join(REPO_ROOT, '.test-dist');

function discoverTestFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...discoverTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

async function buildTests() {
  rmSync(TEST_DIST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIST_DIR, { recursive: true });

  const testFiles = discoverTestFiles(TESTS_DIR);
  if (testFiles.length === 0) {
    console.log('[build-tests] No *.test.ts files found under tests/');
    return;
  }

  await Promise.all(
    testFiles.map((absInput) => {
      const rel = path.relative(TESTS_DIR, absInput);
      const flatName = rel.split(path.sep).join('--').replace(/\.ts$/, '.cjs');
      const outFile = path.join(TEST_DIST_DIR, flatName);
      return esbuild.build({
        entryPoints: [absInput],
        outfile: outFile,
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        external: ['sidecar_sdk'],
        sourcemap: 'inline',
      });
    })
  );

  console.log(`[build-tests] Compiled ${testFiles.length} test file(s) into .test-dist/`);
}

buildTests().catch((err) => {
  console.error('[build-tests] Failed:', err);
  process.exit(1);
});
