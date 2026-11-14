import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  CLI_VERSION,
  runCli,
  runConfigCommand,
  runDoctorCheck,
  runDoctorCommand,
} from '../../src/cli/main';

const tempDirs: string[] = [];
const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_CONVERSATION_ID',
  'ANTIGRAVITY_PULSE_STATE_DIR',
];

function createTempDir(prefix = 'pulse-cli-cmd-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    SAVED_ENV[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = SAVED_ENV[key];
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function collectStream(): { stream: PassThrough; readText: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return {
    stream,
    readText: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function resolveRepoRoot(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  for (const dir of candidates) {
    if (
      existsSync(path.join(dir, 'package.json')) &&
      existsSync(path.join(dir, 'src/cli/main.ts')) &&
      existsSync(path.join(dir, 'bin/agy-pulse'))
    ) {
      return dir;
    }
  }
  throw new Error(`Unable to locate repository root from cwd=${process.cwd()}`);
}

const REQUIRED_PLUGIN_REL_PATHS = [
  'plugin.json',
  'hooks.json',
  'mcp_config.json',
  'skills/model-pulse/SKILL.md',
  'dist/hook-probe.cjs',
  'dist/mcp.cjs',
  'dist/cli.cjs',
  'sidecars/pulse_cockpit/dist/server.mjs',
  'sidecars/pulse_cockpit/dist/ui.js',
];

function createMockPluginDir(baseDir: string): string {
  for (const rel of REQUIRED_PLUGIN_REL_PATHS) {
    const full = path.join(baseDir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '// stub\n', 'utf8');
  }
  return baseDir;
}

describe('cli router, config, doctor, and launchers', () => {
  it('handles --version, --help, offline status json, and unknown commands/flags', async () => {
    const dir = createTempDir();

    const verOut = collectStream();
    const verErr = collectStream();
    const verCode = await runCli(['node', 'agy-pulse', '--version'], {
      stdout: verOut.stream,
      stderr: verErr.stream,
    });
    assert.equal(verCode, 0);
    assert.equal(verOut.readText(), `antigravity-pulse v${CLI_VERSION}\n`);
    assert.equal(verErr.readText(), '');

    const helpOut = collectStream();
    assert.equal(
      await runCli(['node', 'agy-pulse', '--help'], {
        stdout: helpOut.stream,
        stderr: collectStream().stream,
      }),
      0
    );
    assert.match(helpOut.readText(), /Usage:/);
    assert.match(helpOut.readText(), /agy-pulse status/);

    const statusOut = collectStream();
    const statusCode = await runCli(
      ['node', 'agy-pulse', 'status', '--format', 'json'],
      {
        stdout: statusOut.stream,
        stderr: collectStream().stream,
        stateDir: dir,
        lsEnv: { address: '', csrfToken: '' },
      }
    );
    assert.equal(statusCode, 0);
    const statusJson = JSON.parse(statusOut.readText());
    assert.equal(statusJson.schemaVersion, 1);
    assert.equal(statusJson.hostConnected, false);
    assert.equal(statusJson.statusClass, 'disconnected');

    const badCmdErr = collectStream();
    const badCmdCode = await runCli(['node', 'agy-pulse', 'nonexistent'], {
      stdout: collectStream().stream,
      stderr: badCmdErr.stream,
    });
    assert.equal(badCmdCode, 2);
    assert.match(badCmdErr.readText(), /Unknown command: nonexistent/);

    const badFlagErr = collectStream();
    const badFlagCode = await runCli(['node', 'agy-pulse', '--bogus'], {
      stdout: collectStream().stream,
      stderr: badFlagErr.stream,
    });
    assert.equal(badFlagCode, 2);
    assert.match(badFlagErr.readText(), /Unknown option: --bogus/);
  });

  it('supports config get/set/reset/path and rejects invalid keys/values without corrupting state', async () => {
    const dir = createTempDir();

    const pathOut = collectStream();
    assert.equal(
      await runConfigCommand(['path', '--state-dir', dir], {
        stdout: pathOut.stream,
        stderr: collectStream().stream,
      }),
      0
    );
    const expectedConfigPath = path.join(dir, 'config.json');
    assert.equal(pathOut.readText().trim(), expectedConfigPath);

    // Set enum & nested threshold
    const setModeOut = collectStream();
    assert.equal(
      await runConfigCommand(
        ['set', 'inlineStampMode', 'every-turn', '--state-dir', dir],
        { stdout: setModeOut.stream, stderr: collectStream().stream }
      ),
      0
    );
    assert.equal(setModeOut.readText().trim(), 'inlineStampMode=every-turn');

    const setThreshOut = collectStream();
    assert.equal(
      await runConfigCommand(
        ['set', 'smartThresholds.contextWarnPct', '65', '--state-dir', dir],
        { stdout: setThreshOut.stream, stderr: collectStream().stream }
      ),
      0
    );
    assert.equal(setThreshOut.readText().trim(), 'smartThresholds.contextWarnPct=65');

    // Get dotted key & full JSON
    const getThreshOut = collectStream();
    assert.equal(
      await runConfigCommand(
        ['get', 'smartThresholds.contextWarnPct', '--state-dir', dir],
        { stdout: getThreshOut.stream, stderr: collectStream().stream }
      ),
      0
    );
    assert.equal(getThreshOut.readText().trim(), '65');

    const snapshotBeforeInvalid = readFileSync(expectedConfigPath, 'utf8');

    // Reject unknown, prototype, readonly, non-numeric, invalid enum, out-of-range
    const invalidCases: string[][] = [
      ['set', 'unknownField', '1'],
      ['set', '__proto__.polluted', 'true'],
      ['set', 'version', '9'],
      ['set', 'smartThresholds.contextWarnPct', 'not-a-number'],
      ['set', 'inlineStampMode', 'sometimes'],
      ['set', 'pollIntervalsMs.active', '10'],
      ['get', 'nonexistentKey'],
    ];

    for (const args of invalidCases) {
      const errStream = collectStream();
      const code = await runConfigCommand([...args, '--state-dir', dir], {
        stdout: collectStream().stream,
        stderr: errStream.stream,
      });
      assert.equal(code, 1, `Expected exit 1 for config ${args.join(' ')}`);
      assert.ok(errStream.readText().trim().length > 0);
    }

    assert.equal(readFileSync(expectedConfigPath, 'utf8'), snapshotBeforeInvalid);

    // Reset restores defaults
    const resetOut = collectStream();
    assert.equal(
      await runConfigCommand(['reset', '--state-dir', dir], {
        stdout: resetOut.stream,
        stderr: collectStream().stream,
      }),
      0
    );
    const resetParsed = JSON.parse(resetOut.readText());
    assert.equal(resetParsed.inlineStampMode, 'smart');
    assert.equal(resetParsed.smartThresholds.contextWarnPct, 70);
  });

  it('runs 5 non-destructive doctor checks with D-007 guard and zero residual probe files', async () => {
    const dir = createTempDir();
    const missingStateDir = path.join(dir, 'not-created-yet');
    const validPluginDir = createMockPluginDir(path.join(dir, 'plugin-valid'));

    // 1) Missing stateDir + absent host LS -> non-fatal warn, ok === true
    const warnReport = await runDoctorCheck({
      stateDir: missingStateDir,
      pluginDir: validPluginDir,
      lsEnv: { address: '', csrfToken: '' },
      pathEnv: '',
    });
    assert.equal(warnReport.ok, true);
    assert.equal(warnReport.checks.length, 5);
    assert.equal(
      warnReport.checks.find((c) => c.id === 'state_dir')?.status,
      'warn'
    );
    assert.equal(
      warnReport.checks.find((c) => c.id === 'host_ls')?.status,
      'warn'
    );
    assert.equal(
      warnReport.checks.find((c) => c.id === 'plugin_install')?.status,
      'pass'
    );
    assert.equal(existsSync(missingStateDir), false);

    // 2) Writable stateDir + live mock LS -> pass, zero doctor-probe.tmp left behind
    const writableStateDir = path.join(dir, 'state-writable');
    mkdirSync(writableStateDir, { recursive: true });
    const mockLsFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ clientModelConfigs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const jsonOut = collectStream();
    const exitPass = await runDoctorCommand(['--json', '--state-dir', writableStateDir], {
      stdout: jsonOut.stream,
      stderr: collectStream().stream,
      pluginDir: validPluginDir,
      lsEnv: { address: '127.0.0.1:41900', csrfToken: 'tok' },
      fetchFn: mockLsFetch,
      pathEnv: path.join(validPluginDir, 'bin'),
    });
    assert.equal(exitPass, 0);
    const passReport = JSON.parse(jsonOut.readText());
    assert.equal(passReport.ok, true);
    assert.equal(
      passReport.checks.find((c: { id: string }) => c.id === 'state_dir')?.status,
      'pass'
    );
    assert.equal(
      passReport.checks.find((c: { id: string }) => c.id === 'host_ls')?.status,
      'pass'
    );
    assert.equal(
      existsSync(path.join(writableStateDir, 'doctor-probe.tmp')),
      false
    );

    // 3) Plugin install containing forbidden rules/ directory -> D-007 fail & exit 1
    const badPluginDir = createMockPluginDir(path.join(dir, 'plugin-bad'));
    mkdirSync(path.join(badPluginDir, 'rules'), { recursive: true });
    writeFileSync(path.join(badPluginDir, 'rules', 'always.md'), '# bad\n', 'utf8');

    const failOut = collectStream();
    const exitFail = await runDoctorCommand(['--json', '--state-dir', writableStateDir], {
      stdout: failOut.stream,
      stderr: collectStream().stream,
      pluginDir: badPluginDir,
      lsEnv: { address: '', csrfToken: '' },
    });
    assert.equal(exitFail, 1);
    const failReport = JSON.parse(failOut.readText());
    assert.equal(failReport.ok, false);
    assert.equal(
      failReport.checks.find((c: { id: string }) => c.id === 'plugin_install')?.status,
      'fail'
    );

    // 4) Resolves ANTIGRAVITY_PLUGIN_DIR env fallback when pluginDir option is omitted
    const prevPluginDir = process.env.ANTIGRAVITY_PLUGIN_DIR;
    try {
      process.env.ANTIGRAVITY_PLUGIN_DIR = validPluginDir;
      const envPluginReport = await runDoctorCheck({
        stateDir: writableStateDir,
        lsEnv: { address: '', csrfToken: '' },
        pathEnv: '',
      });
      const envPluginCheck = envPluginReport.checks.find(
        (c) => c.id === 'plugin_install'
      );
      assert.equal(envPluginCheck?.status, 'pass');
      assert.equal(envPluginCheck?.details?.pluginDir, validPluginDir);
    } finally {
      if (prevPluginDir === undefined) {
        delete process.env.ANTIGRAVITY_PLUGIN_DIR;
      } else {
        process.env.ANTIGRAVITY_PLUGIN_DIR = prevPluginDir;
      }
    }
  });

  it('verifies launcher line endings, symlink resolution, PATH-stripped agy-node fallback (RTM-20), and exit 127', () => {
    const repoRoot = resolveRepoRoot();
    const shContent = readFileSync(path.join(repoRoot, 'bin/agy-pulse'), 'utf8');
    const cmdContent = readFileSync(path.join(repoRoot, 'bin/agy-pulse.cmd'), 'utf8');
    const ps1Content = readFileSync(path.join(repoRoot, 'bin/agy-pulse.ps1'), 'utf8');

    assert.equal(shContent.includes('\r'), false, 'bin/agy-pulse must use LF');
    assert.notEqual(
      statSync(path.join(repoRoot, 'bin/agy-pulse')).mode & 0o111,
      0,
      'bin/agy-pulse must be executable'
    );
    assert.ok(cmdContent.includes('\r\n') && !cmdContent.replace(/\r\n/g, '').includes('\n'));
    assert.ok(ps1Content.includes('\r\n') && !ps1Content.replace(/\r\n/g, '').includes('\n'));
    assert.match(cmdContent, /agy-node\.exe/);
    assert.match(ps1Content, /agy-node\.exe/);

    // Stage an isolated copy of bin/agy-pulse + esbuild-compiled dist/cli.cjs in temp dir
    const stageRoot = createTempDir('pulse-launcher-');
    const stageBin = path.join(stageRoot, 'bin');
    const stageDist = path.join(stageRoot, 'dist');
    mkdirSync(stageBin, { recursive: true });
    mkdirSync(stageDist, { recursive: true });

    const stagedLauncher = path.join(stageBin, 'agy-pulse');
    copyFileSync(path.join(repoRoot, 'bin/agy-pulse'), stagedLauncher);
    chmodSync(stagedLauncher, 0o755);

    const esbuildBin = path.join(repoRoot, 'node_modules/esbuild/bin/esbuild');
    execFileSync(esbuildBin, [
      path.join(repoRoot, 'src/cli/main.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${path.join(stageDist, 'cli.cjs')}`,
    ]);

    // 1) Direct invocation + symlink invocation
    const linkDir = path.join(stageRoot, 'links');
    mkdirSync(linkDir, { recursive: true });
    const symLauncher = path.join(linkDir, 'agy-pulse');
    symlinkSync(stagedLauncher, symLauncher);

    const symOut = execFileSync(symLauncher, ['--version'], { encoding: 'utf8' });
    assert.equal(symOut, `antigravity-pulse v${CLI_VERSION}\n`);

    // 2) PATH-stripped mock agy-node fallback (no `node` anywhere on PATH)
    const strippedBin = path.join(stageRoot, 'stripped-bin');
    mkdirSync(strippedBin, { recursive: true });
    for (const tool of ['dirname', 'readlink']) {
      const sysDir = ['/usr/bin', '/bin'].find((d) => existsSync(path.join(d, tool)));
      assert.ok(sysDir, `System binary ${tool} not found in /usr/bin or /bin`);
      symlinkSync(path.join(sysDir, tool), path.join(strippedBin, tool));
    }

    const agyNodeShim = path.join(strippedBin, 'agy-node');
    writeFileSync(
      agyNodeShim,
      `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
      { encoding: 'utf8', mode: 0o755 }
    );

    const fallbackOut = execFileSync('/bin/sh', [stagedLauncher, '--version'], {
      env: { PATH: strippedBin },
      encoding: 'utf8',
    });
    assert.equal(fallbackOut, `antigravity-pulse v${CLI_VERSION}\n`);

    // 3) HOME/.config/Antigravity/bin/agy-node fallback when both node & agy-node absent from PATH
    const noNodeBin = path.join(stageRoot, 'no-node-bin');
    mkdirSync(noNodeBin, { recursive: true });
    for (const tool of ['dirname', 'readlink']) {
      const sysDir = ['/usr/bin', '/bin'].find((d) => existsSync(path.join(d, tool)));
      if (sysDir) {
        symlinkSync(path.join(sysDir, tool), path.join(noNodeBin, tool));
      }
    }
    const fakeHome = path.join(stageRoot, 'fake-home');
    const homeAgyBin = path.join(fakeHome, '.config/Antigravity/bin');
    mkdirSync(homeAgyBin, { recursive: true });
    writeFileSync(
      path.join(homeAgyBin, 'agy-node'),
      `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
      { encoding: 'utf8', mode: 0o755 }
    );
    const homeFallbackOut = execFileSync('/bin/sh', [stagedLauncher, '--version'], {
      env: { PATH: noNodeBin, HOME: fakeHome },
      encoding: 'utf8',
    });
    assert.equal(homeFallbackOut, `antigravity-pulse v${CLI_VERSION}\n`);

    // 4) Unset HOME + missing runtimes -> clean exit 127 without `HOME: parameter not set`
    let missingStatus = 0;
    let missingStderr = '';
    try {
      execFileSync('/bin/sh', [stagedLauncher, '--version'], {
        env: { PATH: noNodeBin },
        encoding: 'utf8',
      });
    } catch (err) {
      const execErr = err as { status?: number; stderr?: string | Buffer };
      missingStatus = execErr.status ?? 0;
      missingStderr = String(execErr.stderr ?? '');
    }
    assert.equal(missingStatus, 127);
    assert.match(missingStderr, /neither node nor agy-node was found in PATH/);
  });
});
