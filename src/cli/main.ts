import { accessSync, constants, existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { ReadOnlyLsClient } from '../rpc/ls-client';
import {
  ConfigValidationError,
  DEFAULT_PULSE_USER_CONFIG,
  loadConfig,
  saveConfig,
  updateConfigPartial,
} from '../state/config-store';
import { getStatePaths } from '../state/state-dir';
import type { PulseUserConfig } from '../types/telemetry';
import type { CliLsEnv } from './snapshot-reader';
import { runStatusCommand } from './status-formatter';
import { runTopCommand } from './top-tui';

export const CLI_VERSION = '0.1.0';

export type DoctorCheckId =
  | 'runtime'
  | 'state_dir'
  | 'host_ls'
  | 'plugin_install'
  | 'launcher_link';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: DoctorCheckId;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  schemaVersion: 1;
  version: string;
  generatedAt: string;
  ok: boolean;
  checks: DoctorCheck[];
}

export interface CliIoOptions {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stateDir?: string;
  pluginDir?: string;
  lsEnv?: CliLsEnv;
  pathEnv?: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  registerProcessSignals?: boolean;
}

const REQUIRED_PLUGIN_FILES = [
  'plugin.json',
  'hooks.json',
  'mcp_config.json',
  'skills/model-pulse/SKILL.md',
  'dist/hook-probe.cjs',
  'dist/mcp.cjs',
  'dist/cli.cjs',
  'sidecars/pulse_cockpit/dist/server.mjs',
  'sidecars/pulse_cockpit/dist/ui.js',
] as const;

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const READONLY_CONFIG_KEYS = new Set(['version', 'updatedAt']);

export function getMainHelpText(): string {
  return [
    'agy-pulse — Model Pulse CLI for Google Antigravity 2.0',
    '',
    'Usage:',
    '  agy-pulse status [--format <waybar|tmux|json|text>] [--watch] [--interval <ms>] [--conversation <uuid>] [--live]',
    '  agy-pulse top [--interval <ms>] [--once] [--conversation <uuid>] [--sort <active-first|topology-tree>] [--no-color]',
    '  agy-pulse config [get [key] | set <key> <value> | reset | path]',
    '  agy-pulse doctor [--json]',
    '  agy-pulse --version',
    '  agy-pulse --help',
    '',
  ].join('\n');
}

export function getConfigHelpText(): string {
  return [
    'Usage: agy-pulse config [subcommand]',
    '',
    'Subcommands:',
    '  get [key]            Print full config JSON or a specific key (supports dotted paths)',
    '  set <key> <value>    Validate and atomically update a config setting',
    '  reset                Reset config to built-in defaults',
    '  path                 Print resolved config.json path',
    '',
    'Options:',
    '  --state-dir <path>   Override $PULSE_STATE_DIR',
    '  -h, --help           Show this help message',
    '',
  ].join('\n');
}

export function getDoctorHelpText(): string {
  return [
    'Usage: agy-pulse doctor [options]',
    '',
    'Options:',
    '  --json               Emit structured JSON diagnostic report',
    '  --state-dir <path>   Override $PULSE_STATE_DIR',
    '  -h, --help           Show this help message',
    '',
  ].join('\n');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveConfigPath(
  source: PulseUserConfig,
  dottedKey: string
): { found: boolean; value: unknown } {
  const segments = dottedKey.split('.');
  if (segments.some((seg) => !seg || FORBIDDEN_SEGMENTS.has(seg))) {
    return { found: false, value: undefined };
  }

  let current: unknown = source;
  for (const seg of segments) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, seg)) {
      return { found: false, value: undefined };
    }
    current = current[seg];
  }
  return { found: true, value: current };
}

function buildConfigPatch(
  dottedKey: string,
  rawValue: string
): { patch?: Record<string, unknown>; parsedValue?: unknown; error?: string; exitCode?: number } {
  if (!dottedKey || READONLY_CONFIG_KEYS.has(dottedKey)) {
    return {
      error: dottedKey
        ? `Config key "${dottedKey}" is read-only.`
        : 'Missing config key.',
      exitCode: 1,
    };
  }

  const segments = dottedKey.split('.');
  if (segments.length === 0 || segments.length > 2 || segments.some((s) => !s || FORBIDDEN_SEGMENTS.has(s))) {
    return { error: `Unknown config key: ${dottedKey}`, exitCode: 1 };
  }

  const defaultLookup = resolveConfigPath(DEFAULT_PULSE_USER_CONFIG, dottedKey);
  if (!defaultLookup.found || isPlainRecord(defaultLookup.value)) {
    return {
      error: defaultLookup.found
        ? `Cannot set nested section "${dottedKey}" directly; specify a leaf key.`
        : `Unknown config key: ${dottedKey}`,
      exitCode: 1,
    };
  }

  let coerced: unknown = rawValue;
  if (typeof defaultLookup.value === 'number') {
    const trimmed = rawValue.trim();
    const num = Number(trimmed);
    if (!trimmed || !Number.isFinite(num)) {
      return {
        error: `Invalid numeric value "${rawValue}" for "${dottedKey}".`,
        exitCode: 1,
      };
    }
    coerced = num;
  }

  if (segments.length === 1) {
    return {
      patch: { [segments[0]]: coerced },
      parsedValue: coerced,
    };
  }

  return {
    patch: {
      [segments[0]]: {
        [segments[1]]: coerced,
      },
    },
    parsedValue: coerced,
  };
}

function extractStateDirFlag(args: string[]): {
  positional: string[];
  stateDir?: string;
  help: boolean;
  json: boolean;
  error?: string;
} {
  const positional: string[] = [];
  let stateDir: string | undefined;
  let help = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--state-dir' || arg.startsWith('--state-dir=')) {
      const dir = arg === '--state-dir' ? args[++i] : arg.slice('--state-dir='.length);
      if (!dir) {
        return { positional, stateDir, help, json, error: 'Missing path after --state-dir.' };
      }
      stateDir = dir;
      continue;
    }
    positional.push(arg);
  }

  return { positional, stateDir, help, json };
}

export async function runConfigCommand(
  args: string[],
  io: CliIoOptions = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  const parsed = extractStateDirFlag(args);
  if (parsed.error) {
    stderr.write(`${parsed.error}\n`);
    stderr.write(getConfigHelpText());
    return 2;
  }
  if (parsed.help) {
    stdout.write(getConfigHelpText());
    return 0;
  }

  const effectiveStateDir = parsed.stateDir ?? io.stateDir;
  const positional = parsed.positional;
  if (parsed.json) {
    stderr.write('Unknown config flag: --json\n');
    stderr.write(getConfigHelpText());
    return 2;
  }

  const action = positional[0] ?? 'get';

  if (action === 'path') {
    if (positional.length > 1) {
      stderr.write(`Unexpected argument for config path: ${positional[1]}\n`);
      stderr.write(getConfigHelpText());
      return 2;
    }
    const paths = getStatePaths(effectiveStateDir);
    stdout.write(`${paths.configPath}\n`);
    return 0;
  }

  if (action === 'get') {
    if (positional.length > 2) {
      stderr.write(`Unexpected argument for config get: ${positional[2]}\n`);
      stderr.write(getConfigHelpText());
      return 2;
    }
    const cfg = loadConfig(effectiveStateDir);
    const key = positional[1];
    if (!key) {
      stdout.write(`${JSON.stringify(cfg, null, 2)}\n`);
      return 0;
    }
    const resolved = resolveConfigPath(cfg, key);
    if (!resolved.found) {
      stderr.write(`Unknown config key: ${key}\n`);
      return 1;
    }
    if (isPlainRecord(resolved.value)) {
      stdout.write(`${JSON.stringify(resolved.value, null, 2)}\n`);
    } else {
      stdout.write(`${String(resolved.value)}\n`);
    }
    return 0;
  }

  if (action === 'set') {
    if (positional.length < 3 || positional.length > 3) {
      stderr.write('Usage: agy-pulse config set <key> <value>\n');
      return 2;
    }
    const [, key, rawValue] = positional;
    const built = buildConfigPatch(key, rawValue);
    if (built.error || !built.patch) {
      stderr.write(`${built.error ?? 'Invalid config update.'}\n`);
      return built.exitCode ?? 1;
    }

    try {
      const updated = updateConfigPartial(built.patch, effectiveStateDir);
      const savedValue = resolveConfigPath(updated, key);
      stdout.write(`${key}=${String(savedValue.value)}\n`);
      return 0;
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        stderr.write(`${err.message}\n`);
        return 1;
      }
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  if (action === 'reset') {
    if (positional.length > 1) {
      stderr.write(`Unexpected argument for config reset: ${positional[1]}\n`);
      stderr.write(getConfigHelpText());
      return 2;
    }
    const resetConfig: PulseUserConfig = {
      ...DEFAULT_PULSE_USER_CONFIG,
      smartThresholds: { ...DEFAULT_PULSE_USER_CONFIG.smartThresholds },
      pollIntervalsMs: { ...DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs },
      updatedAt: new Date().toISOString(),
    };
    saveConfig(resetConfig, effectiveStateDir);
    stdout.write(`${JSON.stringify(resetConfig, null, 2)}\n`);
    return 0;
  }

  stderr.write(`Unknown config subcommand: ${action}\n`);
  stderr.write(getConfigHelpText());
  return 2;
}

function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function checkRuntime(): DoctorCheck {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split('.')[0]);
  if (!Number.isFinite(major) || major < 20) {
    return {
      id: 'runtime',
      status: 'warn',
      message: `Node.js v${nodeVersion} detected; v20+ is recommended`,
      details: { nodeVersion, execPath: process.execPath, platform: process.platform },
    };
  }
  return {
    id: 'runtime',
    status: 'pass',
    message: `Node.js v${nodeVersion} (${process.execPath})`,
    details: { nodeVersion, execPath: process.execPath, platform: process.platform },
  };
}

function checkStateDir(overrideDir?: string): DoctorCheck {
  const paths = getStatePaths(overrideDir);
  if (!existsSync(paths.stateDir)) {
    return {
      id: 'state_dir',
      status: 'warn',
      message: `State directory does not exist yet: ${paths.stateDir} (will be created on first hook/sidecar run)`,
      details: { stateDir: paths.stateDir, exists: false },
    };
  }

  try {
    const st = statSync(paths.stateDir);
    if (!st.isDirectory()) {
      return {
        id: 'state_dir',
        status: 'fail',
        message: `State path exists but is not a directory: ${paths.stateDir}`,
        details: { stateDir: paths.stateDir, exists: true, isDirectory: false },
      };
    }
  } catch (err) {
    return {
      id: 'state_dir',
      status: 'fail',
      message: `Cannot stat state directory ${paths.stateDir}: ${err instanceof Error ? err.message : String(err)}`,
      details: { stateDir: paths.stateDir },
    };
  }

  const probePath = join(paths.stateDir, 'doctor-probe.tmp');
  try {
    writeFileSync(probePath, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600 });
    return {
      id: 'state_dir',
      status: 'pass',
      message: `Writable state directory: ${paths.stateDir}`,
      details: {
        stateDir: paths.stateDir,
        hasLiveSnapshot: existsSync(paths.liveSnapshot),
        hasConfig: existsSync(paths.configPath),
      },
    };
  } catch (err) {
    return {
      id: 'state_dir',
      status: 'fail',
      message: `State directory is not writable (${paths.stateDir}): ${err instanceof Error ? err.message : String(err)}`,
      details: { stateDir: paths.stateDir },
    };
  } finally {
    try {
      if (existsSync(probePath)) {
        unlinkSync(probePath);
      }
    } catch {
      // ignore cleanup failure
    }
  }
}

async function checkHostLs(
  lsEnv?: CliLsEnv,
  fetchFn?: typeof fetch
): Promise<DoctorCheck> {
  const address = (lsEnv?.address ?? process.env.ANTIGRAVITY_LS_ADDRESS ?? '').trim();
  const csrfToken = (lsEnv?.csrfToken ?? process.env.ANTIGRAVITY_CSRF_TOKEN ?? '').trim();

  if (!address || !csrfToken) {
    return {
      id: 'host_ls',
      status: 'warn',
      message: 'Host Language Server env vars not exposed in shell (offline/cached mode)',
      details: { configured: false },
    };
  }

  const client = new ReadOnlyLsClient({
    address,
    csrfToken,
    timeoutMs: 1500,
    fetchFn,
  });

  try {
    await client.getCascadeModelConfigData();
    return {
      id: 'host_ls',
      status: 'pass',
      message: `Connected read-only to Language Server at ${address}`,
      details: { configured: true, address },
    };
  } catch (err) {
    return {
      id: 'host_ls',
      status: 'warn',
      message: `Language Server unreachable at ${address}: ${err instanceof Error ? err.message : String(err)}`,
      details: { configured: true, address },
    };
  }
}

function checkPluginInstall(overridePluginDir?: string): DoctorCheck {
  const envPluginDir = process.env.ANTIGRAVITY_PLUGIN_DIR?.trim();
  const pluginDir =
    overridePluginDir?.trim() ||
    envPluginDir ||
    join(homedir(), '.gemini', 'config', 'plugins', 'antigravity-pulse');

  if (!existsSync(pluginDir)) {
    return {
      id: 'plugin_install',
      status: 'warn',
      message: `Installed plugin directory not found at ${pluginDir} (run npm run install:global)`,
      details: { pluginDir, exists: false },
    };
  }

  const forbiddenDirs = ['rules', '.agents'].filter((d) => existsSync(join(pluginDir, d)));
  const forbiddenFiles = ['AGENTS.md'].filter((f) => existsSync(join(pluginDir, f)));
  if (forbiddenDirs.length > 0 || forbiddenFiles.length > 0) {
    return {
      id: 'plugin_install',
      status: 'fail',
      message: `D-007 zero-token violation in ${pluginDir}: unexpected ${[...forbiddenDirs, ...forbiddenFiles].join(', ')}`,
      details: { pluginDir, forbiddenDirs, forbiddenFiles },
    };
  }

  const missingFiles = REQUIRED_PLUGIN_FILES.filter(
    (rel) => !existsSync(join(pluginDir, rel))
  );
  if (missingFiles.length > 0) {
    return {
      id: 'plugin_install',
      status: 'fail',
      message: `Incomplete plugin install at ${pluginDir}; missing: ${missingFiles.join(', ')}`,
      details: { pluginDir, missingFiles },
    };
  }

  return {
    id: 'plugin_install',
    status: 'pass',
    message: `Plugin directory valid (${REQUIRED_PLUGIN_FILES.length} core files present, zero rules/)`,
    details: { pluginDir, checkedFiles: REQUIRED_PLUGIN_FILES.length },
  };
}

function checkLauncherLink(pathEnv?: string, overridePluginDir?: string): DoctorCheck {
  const names = process.platform === 'win32' ? ['agy-pulse.cmd', 'agy-pulse.ps1'] : ['agy-pulse'];
  const entries = (pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean);

  for (const dir of entries) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) {
        return {
          id: 'launcher_link',
          status: 'pass',
          message: `Launcher available on PATH: ${candidate}`,
          details: { path: candidate, onPath: true },
        };
      }
    }
  }

  const fallbackCandidates = [
    ...(overridePluginDir ? [join(overridePluginDir, 'bin', names[0])] : []),
    join(homedir(), '.local', 'bin', names[0]),
    resolve(dirname(__filename), '..', 'bin', names[0]),
    resolve(dirname(__filename), '..', '..', 'bin', names[0]),
  ];

  for (const candidate of fallbackCandidates) {
    if (isExecutableFile(candidate)) {
      return {
        id: 'launcher_link',
        status: 'warn',
        message: `Launcher exists at ${candidate}, but agy-pulse is not on PATH`,
        details: { path: candidate, onPath: false },
      };
    }
  }

  return {
    id: 'launcher_link',
    status: 'warn',
    message: 'agy-pulse launcher was not found on PATH or standard ~/.local/bin',
    details: { onPath: false },
  };
}

export async function runDoctorCheck(options: {
  stateDir?: string;
  pluginDir?: string;
  lsEnv?: CliLsEnv;
  pathEnv?: string;
  fetchFn?: typeof fetch;
} = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    checkRuntime(),
    checkStateDir(options.stateDir),
    await checkHostLs(options.lsEnv, options.fetchFn),
    checkPluginInstall(options.pluginDir),
    checkLauncherLink(options.pathEnv, options.pluginDir),
  ];

  return {
    schemaVersion: 1,
    version: CLI_VERSION,
    generatedAt: new Date().toISOString(),
    ok: checks.every((c) => c.status !== 'fail'),
    checks,
  };
}

export async function runDoctorCommand(
  args: string[],
  io: CliIoOptions = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  const parsed = extractStateDirFlag(args);
  if (parsed.error) {
    stderr.write(`${parsed.error}\n`);
    stderr.write(getDoctorHelpText());
    return 2;
  }
  if (parsed.help) {
    stdout.write(getDoctorHelpText());
    return 0;
  }
  if (parsed.positional.length > 0) {
    stderr.write(`Unknown doctor argument: ${parsed.positional[0]}\n`);
    stderr.write(getDoctorHelpText());
    return 2;
  }

  const report = await runDoctorCheck({
    stateDir: parsed.stateDir ?? io.stateDir,
    pluginDir: io.pluginDir,
    lsEnv: io.lsEnv,
    pathEnv: io.pathEnv,
    fetchFn: io.fetchFn,
  });

  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [
      `Model Pulse Doctor (antigravity-pulse v${report.version})`,
      ...report.checks.map(
        (c) => `[${c.status.toUpperCase()}] ${c.id}: ${c.message}`
      ),
      `Overall: ${report.ok ? 'OK' : 'FAILED'}`,
    ];
    stdout.write(`${lines.join('\n')}\n`);
  }

  return report.ok ? 0 : 1;
}

export async function runCli(
  argv: string[],
  io: CliIoOptions = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    stdout.write(getMainHelpText());
    return 0;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    stdout.write(`antigravity-pulse v${CLI_VERSION}\n`);
    return 0;
  }

  const command = args[0];
  const subArgs = args.slice(1);

  if (command === 'status') {
    return runStatusCommand(subArgs, {
      stdout,
      stderr,
      stateDir: io.stateDir,
      lsEnv: io.lsEnv,
      signal: io.signal,
      fetchFn: io.fetchFn,
      registerProcessSignals: io.registerProcessSignals,
    });
  }

  if (command === 'top') {
    return runTopCommand(subArgs, {
      stdin: io.stdin,
      stdout,
      stderr,
      stateDir: io.stateDir,
      lsEnv: io.lsEnv,
      fetchFn: io.fetchFn,
      registerProcessSignals: io.registerProcessSignals,
    });
  }

  if (command === 'config') {
    return runConfigCommand(subArgs, io);
  }

  if (command === 'doctor') {
    return runDoctorCommand(subArgs, io);
  }

  if (command.startsWith('-')) {
    stderr.write(`Unknown option: ${command}\n`);
  } else {
    stderr.write(`Unknown command: ${command}\n`);
  }
  stderr.write(getMainHelpText());
  return 2;
}

function isCliEntrypoint(): boolean {
  return (
    typeof require !== 'undefined' &&
    typeof module !== 'undefined' &&
    require.main === module &&
    typeof require.main?.filename === 'string' &&
    /(?:^|[\\/])(?:main|cli)\.(?:c?js|mjs|ts)$/i.test(require.main.filename)
  );
}

if (isCliEntrypoint()) {
  void runCli(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(
        `agy-pulse error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    }
  );
}
