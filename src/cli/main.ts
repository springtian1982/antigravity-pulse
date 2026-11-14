import { getStatePaths, readJsonSafe, type LiveSnapshotFile } from '../state/state-dir';

const VERSION = '0.1.0';

function printHelp(): void {
  process.stdout.write(
    [
      'agy-pulse — Model Pulse CLI for Google Antigravity 2.0',
      '',
      'Usage:',
      '  agy-pulse status [--format json]',
      '  agy-pulse --version',
      '  agy-pulse --help',
      '',
    ].join('\n')
  );
}

export function runCli(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const command = args[0];
  if (command === 'status') {
    const paths = getStatePaths();
    const snapshot = readJsonSafe<LiveSnapshotFile | null>(paths.liveSnapshot, null);
    const payload = {
      ok: true,
      version: VERSION,
      connected: Boolean(snapshot?.hostConnected),
      stateDir: paths.stateDir,
      snapshot,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  return 1;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  process.exitCode = runCli(process.argv);
}
