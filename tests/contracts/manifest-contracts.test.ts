import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const REPO_ROOT = existsSync(path.resolve(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../..');

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-contract-test-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function readRepoJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relPath), 'utf8')) as T;
}

describe('package.json & plugin manifest contracts', () => {
  it('enforces zero runtime dependencies, 6 scripts, and strict files allowlist', () => {
    const pkg = readRepoJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      files?: string[];
    }>('package.json');

    assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
    assert.ok(pkg.devDependencies?.esbuild);
    assert.ok(pkg.devDependencies?.typescript);
    assert.ok(pkg.devDependencies?.['@types/node']);

    for (const scriptName of [
      'build',
      'typecheck',
      'test',
      'install:global',
      'verify:context',
      'preview',
    ]) {
      assert.ok(pkg.scripts?.[scriptName], `Missing script "${scriptName}"`);
    }

    const files = new Set(pkg.files ?? []);
    for (const forbidden of ['.agents', '.agents/', 'rules', 'rules/', 'src', 'src/', 'tests', 'tests/', '.stitch', '.stitch/', 'AGENTS.md']) {
      assert.equal(files.has(forbidden), false, `Forbidden entry in files: ${forbidden}`);
    }
  });

  it('validates plugin.json, hooks.json (L-006), mcp_config.json, sidecar.json (D-002), and SKILL.md (D-007)', () => {
    const plugin = readRepoJson<{
      name: string;
      displayName: string;
      logo: string;
      suggestedPrompts: string[];
    }>('plugin.json');
    assert.equal(plugin.name, 'antigravity-pulse');
    assert.equal(plugin.displayName, 'Model Pulse');
    assert.equal(existsSync(path.join(REPO_ROOT, plugin.logo)), true);
    assert.ok(Array.isArray(plugin.suggestedPrompts) && plugin.suggestedPrompts.length >= 1);

    const hooks = readRepoJson<
      Record<
        string,
        {
          PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>;
          PostToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>;
          PreInvocation: Array<{ type: string; command: string; timeout: number }>;
          PostInvocation: Array<{ type: string; command: string; timeout: number }>;
          Stop: Array<{ type: string; command: string; timeout: number }>;
        }
      >
    >('hooks.json');
    const group = hooks['pulse-telemetry'];
    assert.ok(group, 'hooks.json must contain "pulse-telemetry" wrapper');
    assert.equal(group.PreToolUse[0].matcher, '*');
    assert.equal(group.PreToolUse[0].hooks[0].command, 'node ./dist/hook-probe.cjs');
    assert.equal(group.PreToolUse[0].hooks[0].timeout, 5);
    assert.equal(group.PostToolUse[0].matcher, '*');
    assert.equal(group.PostToolUse[0].hooks[0].command, 'node ./dist/hook-probe.cjs');
    assert.equal(group.PostToolUse[0].hooks[0].timeout, 5);
    for (const flatEvent of ['PreInvocation', 'PostInvocation', 'Stop'] as const) {
      assert.equal(group[flatEvent][0].type, 'command');
      assert.equal(group[flatEvent][0].command, 'node ./dist/hook-probe.cjs');
      assert.equal(group[flatEvent][0].timeout, 5);
    }

    const mcp = readRepoJson<{
      mcpServers: Record<string, { command: string; args: string[] }>;
    }>('mcp_config.json');
    assert.equal(mcp.mcpServers['antigravity-pulse'].command, 'node');
    assert.deepEqual(mcp.mcpServers['antigravity-pulse'].args, ['dist/mcp.cjs']);

    const sidecar = readRepoJson<{
      command: string;
      args: string[];
      has_web_ui: boolean;
      ui_config: { views: Array<{ path: string; entrypoint: string; title: string }> };
    }>('sidecars/pulse_cockpit/sidecar.json');
    assert.equal(sidecar.command, 'node');
    assert.deepEqual(sidecar.args, ['dist/server.mjs']);
    assert.equal(sidecar.has_web_ui, true);
    assert.deepEqual(
      sidecar.ui_config.views.map((v) => ({ path: v.path, entrypoint: v.entrypoint })),
      [
        { path: '/hud', entrypoint: 'SIDECAR_UI_ENTRYPOINT_AUX_PANE' },
        { path: '/fleet', entrypoint: 'SIDECAR_UI_ENTRYPOINT_SIDEBAR' },
      ]
    );

    assert.equal(existsSync(path.join(REPO_ROOT, 'rules')), false, 'D-007: root rules/ forbidden');
    const skillText = readFileSync(path.join(REPO_ROOT, 'skills/model-pulse/SKILL.md'), 'utf8');
    assert.match(skillText, /^---\n[\s\S]*name:\s*model-pulse[\s\S]*\n---/);
    assert.ok(skillText.includes('sidecar://antigravity-pulse/pulse_cockpit/hud'));
    assert.ok(Buffer.byteLength(skillText, 'utf8') < 18000);
  });

  it('verifies bin/ launchers (permissions, line endings, agy-node fallback) and 5 prebuilt dist bundles', () => {
    const shLauncher = readFileSync(path.join(REPO_ROOT, 'bin/agy-pulse'), 'utf8');
    assert.equal(shLauncher.includes('\r\n'), false, 'bin/agy-pulse must use LF');
    assert.ok(shLauncher.includes('agy-node'));
    if (process.platform !== 'win32') {
      assert.equal((statSync(path.join(REPO_ROOT, 'bin/agy-pulse')).mode & 0o111) !== 0, true);
    }

    const cmdLauncher = readFileSync(path.join(REPO_ROOT, 'bin/agy-pulse.cmd'), 'utf8');
    assert.equal(cmdLauncher.includes('\r\n'), true, 'bin/agy-pulse.cmd must use CRLF');
    assert.ok(cmdLauncher.includes('agy-node.exe'));

    const ps1Launcher = readFileSync(path.join(REPO_ROOT, 'bin/agy-pulse.ps1'), 'utf8');
    assert.equal(ps1Launcher.includes('\r\n'), true, 'bin/agy-pulse.ps1 must use CRLF');
    assert.ok(ps1Launcher.includes('agy-node.exe'));

    const expectedBundles = [
      'dist/hook-probe.cjs',
      'dist/mcp.cjs',
      'dist/cli.cjs',
      'sidecars/pulse_cockpit/dist/server.mjs',
      'sidecars/pulse_cockpit/dist/ui.js',
    ];
    for (const rel of expectedBundles) {
      const full = path.join(REPO_ROOT, rel);
      assert.equal(existsSync(full), true, `Missing bundle ${rel}`);
      const content = readFileSync(full, 'utf8');
      assert.ok(content.length > 0, `Empty bundle ${rel}`);
      assert.ok(
        content.includes('Copyright (c) 2026 springtian <springtian@gmail.com>'),
        `Missing SPDX MIT copyright header in ${rel}`
      );
    }

    const serverBundle = readFileSync(
      path.join(REPO_ROOT, 'sidecars/pulse_cockpit/dist/server.mjs'),
      'utf8'
    );
    assert.match(serverBundle, /import\s*\{[^}]*SidecarApp[^}]*\}\s*from\s*["']sidecar_sdk["']/);
    assert.ok(serverBundle.includes('new Response('));
    assert.ok(serverBundle.includes("default-src 'self'; script-src 'self';"));
  });
});

describe('runtime smoke tests: hook-probe, cli, mcp & inode-preserving installer', () => {
  it('hook-probe.cjs fails open cleanly and emits {"decision":"allow"} for PreToolUse and {} otherwise', () => {
    const stateDir = makeTempDir('pulse-hook-state-');
    const hookBundle = path.join(REPO_ROOT, 'dist/hook-probe.cjs');
    const env = { ...process.env, ANTIGRAVITY_PULSE_STATE_DIR: stateDir };

    const preToolOut = execFileSync(process.execPath, [hookBundle], {
      input: JSON.stringify({
        hookEventName: 'PreToolUse',
        conversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a',
        toolName: 'run_command',
      }),
      encoding: 'utf8',
      env,
    }).trim();
    assert.deepEqual(JSON.parse(preToolOut), { decision: 'allow' });

    for (const input of [
      JSON.stringify({ hookEventName: 'Stop', conversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a' }),
      JSON.stringify({ hookEventName: 'PreInvocation', conversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a' }),
      JSON.stringify({ hookEventName: 'PostToolUse', conversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a' }),
      '{corrupt-json',
      '',
    ]) {
      const out = execFileSync(process.execPath, [hookBundle], {
        input,
        encoding: 'utf8',
        env,
      }).trim();
      assert.deepEqual(JSON.parse(out), {});
    }
  });

  it('cli.cjs and mcp.cjs Stage 0 entry scaffolds respond cleanly', () => {
    const stateDir = makeTempDir('pulse-cli-state-');
    const env = { ...process.env, ANTIGRAVITY_PULSE_STATE_DIR: stateDir };

    const ver = execFileSync(process.execPath, [path.join(REPO_ROOT, 'dist/cli.cjs'), '--version'], {
      encoding: 'utf8',
      env,
    }).trim();
    assert.equal(ver, '0.1.0');

    const statusRaw = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'dist/cli.cjs'), 'status', '--format', 'json'],
      { encoding: 'utf8', env }
    );
    const statusJson = JSON.parse(statusRaw) as { ok: boolean; connected: boolean };
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.connected, false);

    const mcpOut = execFileSync(process.execPath, [path.join(REPO_ROOT, 'dist/mcp.cjs')], {
      input: [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      ].join('\n') + '\n',
      encoding: 'utf8',
      env,
    });
    const responses = mcpOut
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result?: Record<string, unknown> });
    assert.equal(responses.length, 3);
    assert.equal(responses[0].id, 1);
    assert.deepEqual(responses[1].result, {});
    assert.deepEqual(responses[2].result, { tools: [] });
  });

  it('install.mjs preserves directory inode across reinstalls, passes strict agy validation, and patches installed-only on --force-patch', () => {
    const sandbox = makeTempDir('pulse-install-');
    const targetDir = path.join(sandbox, 'plugin');
    const binDir = path.join(sandbox, 'bin');
    const installScript = path.join(REPO_ROOT, 'scripts/install.mjs');

    execFileSync(
      process.execPath,
      [installScript, '--target-dir', targetDir, '--bin-dir', binDir],
      { encoding: 'utf8' }
    );
    const firstIno = statSync(targetDir).ino;
    const markerPath = path.join(targetDir, 'runtime-marker.txt');
    writeFileSync(markerPath, 'alive', 'utf8');

    execFileSync(
      process.execPath,
      [installScript, '--target-dir', targetDir, '--bin-dir', binDir],
      { encoding: 'utf8' }
    );
    const secondIno = statSync(targetDir).ino;
    assert.equal(secondIno, firstIno, 'Directory inode MUST be preserved across reinstalls (D-006)');
    assert.equal(readFileSync(markerPath, 'utf8'), 'alive');

    assert.equal(existsSync(path.join(targetDir, 'AGENTS.md')), false);
    assert.equal(existsSync(path.join(targetDir, '.agents')), false);
    assert.equal(existsSync(path.join(targetDir, 'rules')), false);

    if (process.platform !== 'win32') {
      const symlinkPath = path.join(binDir, 'agy-pulse');
      assert.equal(lstatSync(symlinkPath).isSymbolicLink(), true);
      assert.equal(
        realpathSync(symlinkPath),
        realpathSync(path.join(targetDir, 'bin/agy-pulse'))
      );
    }

    // Strict agy validation on installed plugin directory (if agy CLI is installed on host)
    let hasAgy = false;
    try {
      execFileSync('agy', ['--version'], { stdio: 'ignore' });
      hasAgy = true;
    } catch {
      hasAgy = false;
    }
    if (hasAgy) {
      const validateOut = execFileSync(
        'agy',
        ['plugin', 'validate', targetDir, '--strict', '--json'],
        { encoding: 'utf8' }
      );
      const report = JSON.parse(validateOut) as {
        findings: unknown[];
        components: { rules: number; hooks: number; mcpServers: number; sidecars: number; skills: number };
      };
      assert.deepEqual(report.findings, []);
      assert.equal(report.components.rules, 0);
      assert.equal(report.components.hooks, 1);
      assert.equal(report.components.mcpServers, 1);
      assert.equal(report.components.sidecars, 1);
      assert.equal(report.components.skills, 1);
    }

    // Verify --node-path + --force-patch mutates ONLY installed manifests, never repo root
    const repoHooksBefore = readFileSync(path.join(REPO_ROOT, 'hooks.json'), 'utf8');
    execFileSync(
      process.execPath,
      [
        installScript,
        '--target-dir',
        targetDir,
        '--bin-dir',
        binDir,
        '--node-path',
        '/custom/agy-node',
        '--force-patch',
      ],
      { encoding: 'utf8' }
    );
    const repoHooksAfter = readFileSync(path.join(REPO_ROOT, 'hooks.json'), 'utf8');
    assert.equal(repoHooksAfter, repoHooksBefore, 'Source repo hooks.json MUST NOT be mutated');

    const installedHooks = JSON.parse(
      readFileSync(path.join(targetDir, 'hooks.json'), 'utf8')
    ) as {
      'pulse-telemetry': {
        PreToolUse: Array<{ hooks: Array<{ command: string }> }>;
        PreInvocation: Array<{ command: string }>;
      };
    };
    assert.equal(
      installedHooks['pulse-telemetry'].PreToolUse[0].hooks[0].command,
      '/custom/agy-node ./dist/hook-probe.cjs'
    );
    assert.equal(
      installedHooks['pulse-telemetry'].PreInvocation[0].command,
      '/custom/agy-node ./dist/hook-probe.cjs'
    );

    const installedMcp = JSON.parse(
      readFileSync(path.join(targetDir, 'mcp_config.json'), 'utf8')
    ) as { mcpServers: { 'antigravity-pulse': { command: string } } };
    assert.equal(installedMcp.mcpServers['antigravity-pulse'].command, '/custom/agy-node');

    const installedSidecar = JSON.parse(
      readFileSync(path.join(targetDir, 'sidecars/pulse_cockpit/sidecar.json'), 'utf8')
    ) as { command: string };
    assert.equal(installedSidecar.command, '/custom/agy-node');
  });

  it('preview-ui.mjs accepts --port 0, --port=0, and PORT=0, logs bound port > 0, and serves assets + stub API', async () => {
    const previewScript = path.join(REPO_ROOT, 'scripts/preview-ui.mjs');

    const withPreviewServer = async (
      args: string[],
      extraEnv: Record<string, string>,
      check: (baseUrl: string) => Promise<void>
    ) => {
      const child = spawn(process.execPath, [previewScript, ...args], {
        cwd: REPO_ROOT,
        env: { ...process.env, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        const boundPort = await new Promise<number>((resolve, reject) => {
          let stdoutBuf = '';
          let stderrBuf = '';
          let settled = false;

          const cleanupListeners = () => {
            clearTimeout(timer);
            child.stdout?.off('data', onStdout);
            child.stderr?.off('data', onStderr);
            child.off('exit', onExit);
            child.off('error', onError);
          };

          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanupListeners();
            reject(
              new Error(
                `Timed out waiting for preview-ui stdout URL. stdout=${JSON.stringify(stdoutBuf)} stderr=${JSON.stringify(stderrBuf)}`
              )
            );
          }, 5000);

          const onStdout = (chunk: Buffer) => {
            stdoutBuf += chunk.toString('utf8');
            const match = /http:\/\/127\.0\.0\.1:(\d+)\/hud/.exec(stdoutBuf);
            if (match) {
              const port = Number(match[1]);
              if (settled) return;
              settled = true;
              cleanupListeners();
              if (!Number.isInteger(port) || port <= 0) {
                reject(new Error(`preview-ui logged invalid bound port: ${stdoutBuf.trim()}`));
                return;
              }
              resolve(port);
            }
          };

          const onStderr = (chunk: Buffer) => {
            stderrBuf += chunk.toString('utf8');
          };

          const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
            if (settled) return;
            settled = true;
            cleanupListeners();
            reject(
              new Error(
                `preview-ui exited prematurely (code=${String(code)}, signal=${String(signal)}): ${stderrBuf}`
              )
            );
          };

          const onError = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanupListeners();
            reject(err);
          };

          child.stdout?.on('data', onStdout);
          child.stderr?.on('data', onStderr);
          child.once('exit', onExit);
          child.once('error', onError);
        });

        await check(`http://127.0.0.1:${boundPort}`);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise<void>((resolve) => {
            const killTimer = setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // ignore already dead process
              }
            }, 1500);
            child.once('exit', () => {
              clearTimeout(killTimer);
              resolve();
            });
            child.kill('SIGTERM');
          });
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    };

    await withPreviewServer(['--port', '0'], {}, async (baseUrl) => {
      const hudRes = await fetch(`${baseUrl}/hud`);
      assert.equal(hudRes.status, 200);
      assert.match(hudRes.headers.get('content-type') ?? '', /^text\/html\b/i);
      const hudBody = await hudRes.text();
      assert.ok(hudBody.length > 0 && hudBody.includes('id="pulse-app"'));

      const cssRes = await fetch(`${baseUrl}/styles.css`);
      assert.equal(cssRes.status, 200);
      assert.match(cssRes.headers.get('content-type') ?? '', /^text\/css\b/i);
      const cssBody = await cssRes.text();
      assert.ok(cssBody.length > 0 && cssBody.includes('.pulse-app'));

      const jsRes = await fetch(`${baseUrl}/dist/ui.js`);
      assert.equal(jsRes.status, 200);
      assert.match(jsRes.headers.get('content-type') ?? '', /^application\/javascript\b/i);
      const jsBody = await jsRes.text();
      assert.ok(jsBody.length > 0);

      const apiRes = await fetch(`${baseUrl}/api/hud`);
      assert.equal(apiRes.status, 200);
      assert.match(apiRes.headers.get('content-type') ?? '', /^application\/json\b/i);
      const apiBody = (await apiRes.json()) as {
        etag: string;
        hostConnected: boolean;
        treeNodes: unknown[];
        warnings: string[];
      };
      assert.equal(apiBody.etag, 'stage0');
      assert.equal(apiBody.hostConnected, false);
      assert.ok(Array.isArray(apiBody.treeNodes));
      assert.ok(apiBody.warnings.includes('Preview mode (Stage 0 stub)'));
    });

    await withPreviewServer(['--port=0'], {}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const json = (await res.json()) as { ok: boolean; preview: boolean };
      assert.equal(json.ok, true);
      assert.equal(json.preview, true);
    });

    await withPreviewServer([], { PORT: '0' }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const json = (await res.json()) as { ok: boolean; preview: boolean };
      assert.equal(json.ok, true);
      assert.equal(json.preview, true);
    });
  });
});

describe('UI Shell & Flexoki CSS contracts (S0-B artifacts)', () => {
  it('validates index.html CSP hygiene, asset load order, DOM mounts, and styles.css Flexoki tokens', () => {
    assert.equal(existsSync(path.join(REPO_ROOT, 'DESIGN.md')), true, 'Missing DESIGN.md');
    const html = readFileSync(path.join(REPO_ROOT, 'sidecars/pulse_cockpit/index.html'), 'utf8');
    const css = readFileSync(path.join(REPO_ROOT, 'sidecars/pulse_cockpit/styles.css'), 'utf8');

    assert.match(html, /<meta\s+name=["']color-scheme["']\s+content=["']light dark["']/i);
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'Inline <script> forbidden by CSP');
    assert.equal(/https?:\/\/[^"'\s>]+/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), false, 'External CDN URLs forbidden');

    const idxPreload = html.indexOf('/preload.js');
    const idxStyles = html.indexOf('/styles.css');
    const idxUi = html.indexOf('/dist/ui.js');
    assert.ok(idxPreload !== -1 && idxStyles !== -1 && idxUi !== -1, 'Missing required local assets');
    assert.ok(idxPreload < idxStyles && idxStyles < idxUi, 'Load order must be /preload.js -> /styles.css -> /dist/ui.js');

    assert.ok(html.includes('id="pulse-app"'));
    assert.match(html, /<main\s+[^>]*id=["']app["']/i);

    const flexokiHexes = [
      '#5e409d',
      '#8b7ec8',
      '#205ea6',
      '#4385be',
      '#24837b',
      '#3aa99f',
      '#ad8301',
      '#d0a215',
      '#af3029',
      '#d14d41',
    ];
    const cssLower = css.toLowerCase();
    for (const hex of flexokiHexes) {
      assert.ok(cssLower.includes(hex), `styles.css missing Flexoki hex ${hex}`);
    }

    assert.ok(css.includes('tabular-nums'), 'styles.css must enforce tabular-nums');
    assert.equal(
      /::-webkit-progress-value\s*,\s*::-moz-progress-bar/i.test(css),
      false,
      'Must NOT group ::-webkit-progress-value and ::-moz-progress-bar in a single rule'
    );

    for (const cls of [
      '.pulse-app',
      '.pulse-main',
      '.pulse-tabs',
      '.pulse-tab',
      '.pulse-tabpanel',
      '.pulse-hero',
      '.pulse-health-row',
      '.pulse-progress',
      '.pulse-matrix',
      '.pulse-node-card',
      '.pulse-pill',
      '.pulse-tier-apex',
      '.pulse-tier-workhorse',
      '.pulse-tier-fast',
      '.pulse-tier-orchestrator',
      '.pulse-tier-alert',
      '.pulse-banner',
      '.pulse-fuel-bar',
      '.pulse-timeline-bar',
      '.pulse-fleet-grid',
      '.pulse-popover',
      '.tabular-nums',
    ]) {
      assert.ok(css.includes(cls), `styles.css missing required class ${cls}`);
    }
  });
});
