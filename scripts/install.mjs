#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    targetDir: path.join(os.homedir(), '.gemini', 'config', 'plugins', 'antigravity-pulse'),
    binDir:
      process.platform === 'win32'
        ? process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps')
          : ''
        : path.join(os.homedir(), '.local', 'bin'),
    nodePath: '',
    forcePatch: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target-dir' && argv[i + 1]) {
      opts.targetDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--target-dir=')) {
      opts.targetDir = path.resolve(arg.slice('--target-dir='.length));
    } else if (arg === '--bin-dir' && argv[i + 1]) {
      opts.binDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--bin-dir=')) {
      opts.binDir = path.resolve(arg.slice('--bin-dir='.length));
    } else if (arg === '--node-path' && argv[i + 1]) {
      opts.nodePath = argv[++i];
    } else if (arg.startsWith('--node-path=')) {
      opts.nodePath = arg.slice('--node-path='.length);
    } else if (arg === '--force-patch') {
      opts.forcePatch = true;
    }
  }
  return opts;
}

function isExecutableFile(filePath) {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function findExecutableOnPath(cmdName) {
  const pathVar = process.env.PATH || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmdName.endsWith(ext) ? cmdName : `${cmdName}${ext}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function findAgyNodeFallback() {
  const candidates =
    process.platform === 'win32'
      ? [
          process.env.APPDATA ? path.join(process.env.APPDATA, 'Antigravity', 'bin', 'agy-node.exe') : '',
          process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', 'bin', 'agy-node.exe')
            : '',
        ]
      : [path.join(os.homedir(), '.config', 'Antigravity', 'bin', 'agy-node')];

  for (const candidate of candidates) {
    if (candidate && isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function writeAtomicBuffer(destPath, buffer, mode) {
  mkdirSync(path.dirname(destPath), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`;
  const tmpPath = `${destPath}.${suffix}.tmp`;
  try {
    writeFileSync(tmpPath, buffer, mode !== undefined ? { mode } : undefined);
    if (process.platform !== 'win32' && mode !== undefined) {
      chmodSync(tmpPath, mode);
    }
    renameSync(tmpPath, destPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

function collectFilesFromAllowlist(repoRoot, allowlist) {
  const files = [];
  for (const entry of allowlist) {
    const cleanRel = entry.replace(/\/+$/, '');
    if (!cleanRel) continue;
    const absPath = path.join(repoRoot, cleanRel);
    if (!existsSync(absPath)) continue;
    const st = statSync(absPath);
    if (st.isFile()) {
      files.push({ absPath, relPath: cleanRel, mode: st.mode });
    } else if (st.isDirectory()) {
      const stack = [absPath];
      while (stack.length > 0) {
        const current = stack.pop();
        for (const item of readdirSync(current, { withFileTypes: true })) {
          const itemAbs = path.join(current, item.name);
          if (item.isDirectory()) {
            stack.push(itemAbs);
          } else if (item.isFile()) {
            const itemStat = statSync(itemAbs);
            files.push({
              absPath: itemAbs,
              relPath: path.relative(repoRoot, itemAbs),
              mode: itemStat.mode,
            });
          }
        }
      }
    }
  }
  return files;
}

function quoteCommandExe(exePath) {
  return /\s/.test(exePath) ? `"${exePath}"` : exePath;
}

function patchInstalledManifests(targetDir, nodeExePath) {
  const quotedExe = quoteCommandExe(nodeExePath);

  const hooksDest = path.join(targetDir, 'hooks.json');
  if (existsSync(hooksDest)) {
    const hooksData = JSON.parse(readFileSync(hooksDest, 'utf8'));
    for (const groupSpec of Object.values(hooksData)) {
      if (!groupSpec || typeof groupSpec !== 'object') continue;
      for (const entries of Object.values(groupSpec)) {
        if (!Array.isArray(entries)) continue;
        for (const item of entries) {
          if (item && typeof item === 'object' && Array.isArray(item.hooks)) {
            for (const hook of item.hooks) {
              if (hook && typeof hook.command === 'string') {
                hook.command = `${quotedExe} ./dist/hook-probe.cjs`;
              }
            }
          } else if (item && typeof item === 'object' && typeof item.command === 'string') {
            item.command = `${quotedExe} ./dist/hook-probe.cjs`;
          }
        }
      }
    }
    writeAtomicBuffer(hooksDest, Buffer.from(`${JSON.stringify(hooksData, null, 2)}\n`, 'utf8'), 0o644);
  }

  const mcpDest = path.join(targetDir, 'mcp_config.json');
  if (existsSync(mcpDest)) {
    const mcpData = JSON.parse(readFileSync(mcpDest, 'utf8'));
    if (mcpData?.mcpServers?.['antigravity-pulse']) {
      mcpData.mcpServers['antigravity-pulse'].command = nodeExePath;
    }
    writeAtomicBuffer(mcpDest, Buffer.from(`${JSON.stringify(mcpData, null, 2)}\n`, 'utf8'), 0o644);
  }

  const sidecarDest = path.join(targetDir, 'sidecars', 'pulse_cockpit', 'sidecar.json');
  if (existsSync(sidecarDest)) {
    const sidecarData = JSON.parse(readFileSync(sidecarDest, 'utf8'));
    sidecarData.command = nodeExePath;
    writeAtomicBuffer(
      sidecarDest,
      Buffer.from(`${JSON.stringify(sidecarData, null, 2)}\n`, 'utf8'),
      0o644
    );
  }
}

function installGlobalCliLink(targetDir, binDir) {
  if (!binDir) return null;
  if (process.platform !== 'win32') {
    mkdirSync(binDir, { recursive: true });
    const targetBin = path.join(targetDir, 'bin', 'agy-pulse');
    const linkDest = path.join(binDir, 'agy-pulse');
    const tmpLink = `${linkDest}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      symlinkSync(targetBin, tmpLink);
      renameSync(tmpLink, linkDest);
    } catch (err) {
      try {
        if (existsSync(tmpLink)) unlinkSync(tmpLink);
      } catch {
        // ignore cleanup error
      }
      throw err;
    }
    return linkDest;
  }

  try {
    mkdirSync(binDir, { recursive: true });
    const shimDest = path.join(binDir, 'agy-pulse.cmd');
    const targetCmd = path.join(targetDir, 'bin', 'agy-pulse.cmd');
    const shimContent = `@echo off\r\ncall "${targetCmd}" %*\r\n`;
    writeAtomicBuffer(shimDest, Buffer.from(shimContent, 'utf8'));
    return shimDest;
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const filesAllowlist = Array.isArray(pkg.files) ? pkg.files : [];

  // Inode-preserving installation (D-006): never rmSync(opts.targetDir)
  mkdirSync(opts.targetDir, { recursive: true });

  const files = collectFilesFromAllowlist(REPO_ROOT, filesAllowlist);
  for (const file of files) {
    const destPath = path.join(opts.targetDir, file.relPath);
    const buf = readFileSync(file.absPath);
    const posixRel = file.relPath.split(path.sep).join('/');
    const shouldExec =
      posixRel === 'bin/agy-pulse' ||
      posixRel === 'dist/cli.cjs' ||
      posixRel === 'dist/mcp.cjs' ||
      (file.mode & 0o111) !== 0;
    writeAtomicBuffer(destPath, buf, shouldExec ? 0o755 : 0o644);
  }

  const systemNode = findExecutableOnPath('node');
  const agyNode = findExecutableOnPath('agy-node') || findAgyNodeFallback();
  const patchTarget = opts.nodePath || (!systemNode ? agyNode : '') || (opts.forcePatch ? systemNode || '' : '');

  let patched = false;
  if ((opts.forcePatch && patchTarget) || (!systemNode && patchTarget)) {
    patchInstalledManifests(opts.targetDir, patchTarget);
    patched = true;
  }

  const cliLink = installGlobalCliLink(opts.targetDir, opts.binDir);
  const onPath = (process.env.PATH || '').split(path.delimiter).includes(opts.binDir);

  console.log(
    `[install] Installed ${files.length} file(s) atomically to ${opts.targetDir}` +
      (patched ? ` (patched installed manifests -> ${patchTarget})` : '')
  );
  if (cliLink) {
    console.log(`[install] CLI linked at ${cliLink}${onPath ? '' : ' (add parent directory to PATH)'}`);
  }
}

main();
