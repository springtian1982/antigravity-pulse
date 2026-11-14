#!/usr/bin/env node
/**
 * Zero-dependency Antigravity Pulse context governance verifier.
 *
 * Usage:
 *   node scripts/verify-context.mjs [--strict-paths] [--json]
 *
 * Checks:
 *   1. L1 AGENTS.md existence, < 9,000 B cap, no YAML frontmatter, no @[...] inlining.
 *   2. L2 .agents/rules/*.md flat layout, valid YAML frontmatter, < 9,000 B cap, combined always-on budget.
 *   3. L3 .agents/skills/<name>/SKILL.md (and distributed skills/<name>/SKILL.md if present) YAML frontmatter & size caps.
 *   4. Zero legacy .agent/, CLAUDE.md, .cursorrules, and zero distributed rules/ directory (D-007).
 *   5. .gitignore invariants: required ignores present & dist/ + sidecars/pulse_cockpit/dist/ NEVER ignored (D-005).
 *   6. Zero broken Markdown links (relative & file://) and zero unknown/stale backtick repo paths.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BYTE_LIMIT_L1 = 9000;
const BYTE_LIMIT_L2_RULE = 9000;
const BYTE_LIMIT_ALWAYS_ON_TOTAL = 18000;
const BYTE_LIMIT_SKILL = 18000;
const VALID_RULE_TRIGGERS = new Set(['always_on', 'model_decision', 'glob', 'manual']);

/**
 * Canonical Stage 0-3 Blueprint §2 / §4.1 paths that do not exist yet during MISSION I.
 * In default mode, non-existent backtick paths MUST belong to this frozen set (catching typos immediately).
 * With --strict-paths (post-Stage-3), every referenced path must exist on disk.
 */
const PLANNED_BLUEPRINT_PATHS = new Set([
  'DESIGN.md',
  'hooks.json',
  'mcp_config.json',
  'bin/agy-pulse',
  'bin/agy-pulse.cmd',
  'bin/agy-pulse.ps1',
  'dist/hook-probe.cjs',
  'dist/mcp.cjs',
  'dist/cli.cjs',
  'sidecars/pulse_cockpit/sidecar.json',
  'sidecars/pulse_cockpit/index.html',
  'sidecars/pulse_cockpit/styles.css',
  'sidecars/pulse_cockpit/dist/server.mjs',
  'sidecars/pulse_cockpit/dist/ui.js',
  'skills/model-pulse/SKILL.md',
  'scripts/build.mjs',
  'scripts/build-tests.mjs',
  'scripts/install.mjs',
  'scripts/preview-ui.mjs',
  'src/types/telemetry.ts',
  'src/types/rpc.ts',
  'src/types/sidecar-sdk.d.ts',
  'src/types/index.ts',
  'src/state/state-dir.ts',
  'src/state/config-store.ts',
  'src/core/model-catalog.ts',
  'src/core/quota-calculator.ts',
  'src/core/state-machine.ts',
  'src/core/topology-builder.ts',
  'src/core/timeline-builder.ts',
  'src/core/fleet-builder.ts',
  'src/core/etag.ts',
  'src/core/formatters.ts',
  'src/rpc/ls-client.ts',
  'src/hook/hook-probe.ts',
  'src/sidecar/telemetry-engine.ts',
  'src/sidecar/server.ts',
  'src/ui/state.ts',
  'src/ui/hud-view.ts',
  'src/ui/fleet-view.ts',
  'src/ui/main.ts',
  'src/mcp/embed-card.ts',
  'src/mcp/server.ts',
  'src/cli/snapshot-reader.ts',
  'src/cli/top-tui.ts',
  'src/cli/status-formatter.ts',
  'src/cli/main.ts',
  'tests/unit/state-dir.test.ts',
  'tests/unit/core-catalog.test.ts',
  'tests/unit/core-etag.test.ts',
  'tests/unit/core-metrics.test.ts',
  'tests/unit/core-quota.test.ts',
  'tests/unit/core-state-machine.test.ts',
  'tests/unit/hook-probe.test.ts',
  'tests/unit/topology-builder.test.ts',
  'tests/unit/timeline-fleet.test.ts',
  'tests/unit/cli-commands.test.ts',
  'tests/unit/cli-status.test.ts',
  'tests/unit/cli-top.test.ts',
  'tests/unit/mcp-embed-card.test.ts',
  'tests/unit/mcp-protocol.test.ts',
  'tests/unit/mcp-tools.test.ts',
  'tests/contracts/manifest-contracts.test.ts',
  'tests/contracts/readonly-guard.test.ts',
  'tests/benchmarks/hook-latency.test.ts',
  'tests/e2e/hud-loop.test.ts',
  'tests/e2e/stage1-acceptance.test.ts',
  'tests/e2e/fleet-timeline.test.ts',
  'tests/e2e/full-system.test.ts',
  'docs/plans/STAGE_0_FOUNDATION_PLAN.md',
  'docs/plans/STAGE_1_MVP_LOOP_PLAN.md',
  'docs/plans/STAGE_2_TIMELINE_FLEET_PLAN.md',
  'docs/plans/STAGE_3_CLI_MCP_GOVERNANCE_PLAN.md',
  'docs/plans/STAGE_0_AUDIT.md',
  'docs/plans/STAGE_1_AUDIT.md',
  'docs/plans/STAGE_2_AUDIT.md',
  'docs/plans/STAGE_3_AUDIT.md',
]);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function relFromRoot(absPath) {
  return toPosix(path.relative(REPO_ROOT, absPath));
}

function unquoteYaml(val) {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Zero-dependency YAML frontmatter parser supporting scalars, block scalars (> / |), and lists.
 */
function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { hasFrontmatter: false, data: {}, body: content };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  const altEndIdx = endIdx === -1 && normalized.endsWith('\n---') ? normalized.length - 4 : endIdx;
  if (altEndIdx === -1) {
    return { hasFrontmatter: false, error: 'Unclosed YAML frontmatter fence (---)', data: {}, body: content };
  }

  const yamlBlock = normalized.slice(4, altEndIdx);
  const body = normalized.slice(altEndIdx + 5);
  const lines = yamlBlock.split('\n');
  const data = {};

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
    if (!match) {
      return { hasFrontmatter: true, error: `Invalid YAML line in frontmatter: "${rawLine}"`, data: {}, body };
    }

    const key = match[1];
    const rest = match[2].trim();

    if (rest === '>' || rest === '>-' || rest === '|' || rest === '|-') {
      const collected = [];
      i++;
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) {
        collected.push(lines[i].trim());
        i++;
      }
      data[key] = collected.filter(Boolean).join(rest.startsWith('>') ? ' ' : '\n').trim();
      continue;
    }

    if (rest === '') {
      const items = [];
      i++;
      while (i < lines.length) {
        const nextTrim = lines[i].trim();
        if (!nextTrim) {
          i++;
          continue;
        }
        if (/^\s*-\s+/.test(lines[i])) {
          items.push(unquoteYaml(lines[i].replace(/^\s*-\s+/, '')));
          i++;
          continue;
        }
        break;
      }
      data[key] = items.length > 0 ? items : '';
      continue;
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      data[key] = inner
        ? inner.split(',').map((item) => unquoteYaml(item)).filter(Boolean)
        : [];
      i++;
      continue;
    }

    data[key] = unquoteYaml(rest);
    i++;
  }

  return { hasFrontmatter: true, data, body };
}

function stripFencedCodeBlocks(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function stripInlineCodeSpans(markdown) {
  return markdown.replace(/`[^`\n]+`/g, '');
}

function listMarkdownFilesRecursive(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMarkdownFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const strictPaths = args.has('--strict-paths');
  const jsonMode = args.has('--json');

  const errors = [];
  const warnings = [];
  const stats = {
    agentsBytes: 0,
    rulesCount: 0,
    alwaysOnBytes: 0,
    skillsCount: 0,
    distributedSkillsCount: 0,
    markdownLinksChecked: 0,
    backtickPathsOnDisk: 0,
    backtickPathsPlanned: 0,
  };

  function fail(msg) {
    errors.push(msg);
  }

  // 1. Legacy & Zero-Token Plugin Hygiene Checks (D-007)
  if (existsSync(path.join(REPO_ROOT, '.agent'))) {
    fail('Legacy ".agent/" directory exists; consolidate into ".agents/" and delete ".agent/".');
  }
  if (existsSync(path.join(REPO_ROOT, 'CLAUDE.md'))) {
    fail('Legacy "CLAUDE.md" exists; AGENTS.md is the sole workspace root SSOT.');
  }
  if (existsSync(path.join(REPO_ROOT, '.cursorrules'))) {
    fail('Legacy ".cursorrules" exists; consolidate into AGENTS.md / .agents/rules/.');
  }
  if (existsSync(path.join(REPO_ROOT, 'rules'))) {
    fail('Plugin-root "rules/" directory exists! Violates D-007 (0-token plugin hygiene).');
  }

  const pkgPath = path.join(REPO_ROOT, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const filesList = Array.isArray(pkg.files) ? pkg.files : [];
      const forbiddenInFiles = new Set(['.agents', '.agents/', 'rules', 'rules/', 'AGENTS.md']);
      for (const item of filesList) {
        if (forbiddenInFiles.has(item)) {
          fail(`package.json "files" MUST NOT include "${item}" (violates D-007 workspace-only governance).`);
        }
      }
    } catch (err) {
      fail(`Failed to parse package.json: ${err.message}`);
    }
  }

  // 2. .gitignore Invariants (D-005)
  const gitignorePath = path.join(REPO_ROOT, '.gitignore');
  if (!existsSync(gitignorePath)) {
    fail('Missing .gitignore at repository root.');
  } else {
    const rawLines = readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    const lineSet = new Set(rawLines);

    const requiredIgnores = [
      { label: 'node_modules/', matches: (s) => s.has('node_modules/') || s.has('node_modules') },
      { label: '.test-dist/', matches: (s) => s.has('.test-dist/') || s.has('.test-dist') },
      { label: '*.tsbuildinfo', matches: (s) => s.has('*.tsbuildinfo') },
      { label: '.DS_Store', matches: (s) => s.has('.DS_Store') },
      { label: '.stitch/exports/', matches: (s) => s.has('.stitch/exports/') || s.has('.stitch/exports') },
    ];
    for (const req of requiredIgnores) {
      if (!req.matches(lineSet)) {
        fail(`.gitignore is missing required ignore rule "${req.label}".`);
      }
    }

    const forbiddenPatterns = new Set([
      'dist',
      'dist/',
      '/dist',
      '/dist/',
      'dist/*',
      'sidecars/pulse_cockpit/dist',
      'sidecars/pulse_cockpit/dist/',
      'sidecars/pulse_cockpit/dist/*',
      '.agents',
      '.agents/',
      '/.agents',
      '/.agents/',
    ]);
    for (const line of rawLines) {
      if (forbiddenPatterns.has(line)) {
        fail(`.gitignore MUST NOT ignore "${line}" (violates D-005 / workspace governance).`);
      }
    }

    if (existsSync(path.join(REPO_ROOT, '.git'))) {
      const probePaths = [
        'dist/hook-probe.cjs',
        'dist/mcp.cjs',
        'dist/cli.cjs',
        'sidecars/pulse_cockpit/dist/server.mjs',
        'sidecars/pulse_cockpit/dist/ui.js',
        '.agents/rules/architecture-and-guardrails.md',
      ];
      for (const probe of probePaths) {
        try {
          const out = execFileSync('git', ['check-ignore', probe], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          if (out) {
            fail(`git check-ignore reports "${probe}" is ignored! Prebuilt dist/ and .agents/ MUST stay tracked.`);
          }
        } catch (err) {
          // Exit code 1 means NOT ignored (expected). Any other code besides 1 indicates a git error.
          if (err.status !== 1) {
            warnings.push(`git check-ignore skipped for "${probe}" (status ${err.status ?? 'unknown'}).`);
          }
        }
      }
    }
  }

  // Track all context markdown files to scan for links, syntax hygiene, and backtick paths
  const contextFiles = [];

  // 3. L1 AGENTS.md Validation
  const agentsMdPath = path.join(REPO_ROOT, 'AGENTS.md');
  if (!existsSync(agentsMdPath)) {
    fail('Missing repository root AGENTS.md.');
  } else {
    const content = readFileSync(agentsMdPath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    stats.agentsBytes = bytes;
    stats.alwaysOnBytes += bytes;

    if (bytes >= BYTE_LIMIT_L1) {
      fail(`AGENTS.md size ${bytes} B exceeds ${BYTE_LIMIT_L1} B cap.`);
    }
    const fm = parseFrontmatter(content);
    if (fm.hasFrontmatter) {
      fail('AGENTS.md MUST NOT contain YAML frontmatter (pure Markdown only).');
    }
    contextFiles.push({ absPath: agentsMdPath, content, checkBacktickPaths: true });
  }

  // 4. L2 .agents/rules/*.md Validation
  const rulesDir = path.join(REPO_ROOT, '.agents', 'rules');
  const rulesJsonExists = existsSync(path.join(REPO_ROOT, '.agents', 'rules.json'));
  if (!existsSync(rulesDir) || !statSync(rulesDir).isDirectory()) {
    fail('Missing ".agents/rules/" directory.');
  } else {
    const allRuleMds = listMarkdownFilesRecursive(rulesDir);
    const topLevelRuleMds = readdirSync(rulesDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => path.join(rulesDir, e.name));

    if (topLevelRuleMds.length === 0) {
      fail('".agents/rules/" must contain at least one top-level .md rule file.');
    }
    if (!rulesJsonExists && allRuleMds.length > topLevelRuleMds.length) {
      fail('Nested subdirectories found in ".agents/rules/" without ".agents/rules.json"; Antigravity skips nested rules.');
    }

    for (const rulePath of allRuleMds) {
      const rel = relFromRoot(rulePath);
      const content = readFileSync(rulePath, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      stats.rulesCount += 1;

      if (bytes >= BYTE_LIMIT_L2_RULE) {
        fail(`${rel} size ${bytes} B exceeds ${BYTE_LIMIT_L2_RULE} B cap.`);
      }

      const fm = parseFrontmatter(content);
      if (!fm.hasFrontmatter || fm.error) {
        fail(`${rel} missing or invalid YAML frontmatter${fm.error ? `: ${fm.error}` : ''}.`);
      } else {
        const trigger = fm.data.trigger;
        if (!VALID_RULE_TRIGGERS.has(trigger)) {
          fail(`${rel} frontmatter "trigger" must be one of always_on|model_decision|glob|manual (got "${trigger ?? ''}").`);
        }
        if ((trigger === 'always_on' || trigger === 'model_decision') && !String(fm.data.description || '').trim()) {
          fail(`${rel} with trigger "${trigger}" requires a non-empty "description" field.`);
        }
        if (trigger === 'glob') {
          const globs = fm.data.globs;
          const hasGlobs = Array.isArray(globs) ? globs.length > 0 : Boolean(String(globs || '').trim());
          if (!hasGlobs) {
            fail(`${rel} with trigger "glob" requires a non-empty "globs" field.`);
          }
        }
        if (trigger === 'always_on') {
          stats.alwaysOnBytes += bytes;
        }
      }

      contextFiles.push({ absPath: rulePath, content, checkBacktickPaths: true });
    }
  }

  if (stats.alwaysOnBytes >= BYTE_LIMIT_ALWAYS_ON_TOTAL) {
    fail(`Combined always-on size (${stats.alwaysOnBytes} B) exceeds ${BYTE_LIMIT_ALWAYS_ON_TOTAL} B green budget.`);
  }

  // 5. L3 .agents/skills/*/SKILL.md Validation
  const workspaceSkillsDir = path.join(REPO_ROOT, '.agents', 'skills');
  if (!existsSync(workspaceSkillsDir) || !statSync(workspaceSkillsDir).isDirectory()) {
    fail('Missing ".agents/skills/" directory.');
  } else {
    const skillFolders = readdirSync(workspaceSkillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (skillFolders.length === 0) {
      fail('".agents/skills/" must contain at least one skill directory.');
    }
    for (const folder of skillFolders) {
      const skillPath = path.join(workspaceSkillsDir, folder.name, 'SKILL.md');
      const rel = relFromRoot(skillPath);
      if (!existsSync(skillPath)) {
        fail(`Missing SKILL.md in ".agents/skills/${folder.name}/".`);
        continue;
      }
      stats.skillsCount += 1;
      const content = readFileSync(skillPath, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes >= BYTE_LIMIT_SKILL) {
        fail(`${rel} size ${bytes} B exceeds ${BYTE_LIMIT_SKILL} B limit.`);
      }
      const fm = parseFrontmatter(content);
      if (!fm.hasFrontmatter || fm.error) {
        fail(`${rel} missing or invalid YAML frontmatter${fm.error ? `: ${fm.error}` : ''}.`);
      } else {
        if (fm.data.name !== folder.name || !/^[a-z0-9-]+$/.test(String(fm.data.name || ''))) {
          fail(`${rel} frontmatter "name" ("${fm.data.name ?? ''}") must match folder "${folder.name}" (lowercase kebab-case).`);
        }
        if (!String(fm.data.description || '').trim()) {
          fail(`${rel} frontmatter requires a non-empty "description".`);
        }
      }
      contextFiles.push({ absPath: skillPath, content, checkBacktickPaths: true });
    }
  }

  // 6. Distributed Plugin Skills skills/*/SKILL.md Hygiene (when Stage 3 creates skills/)
  const distSkillsDir = path.join(REPO_ROOT, 'skills');
  if (existsSync(distSkillsDir) && statSync(distSkillsDir).isDirectory()) {
    const skillFolders = readdirSync(distSkillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const folder of skillFolders) {
      const skillPath = path.join(distSkillsDir, folder.name, 'SKILL.md');
      const rel = relFromRoot(skillPath);
      if (!existsSync(skillPath)) {
        fail(`Missing SKILL.md in distributed "skills/${folder.name}/".`);
        continue;
      }
      stats.distributedSkillsCount += 1;
      const content = readFileSync(skillPath, 'utf8');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes >= BYTE_LIMIT_SKILL) {
        fail(`${rel} size ${bytes} B exceeds ${BYTE_LIMIT_SKILL} B limit.`);
      }
      const fm = parseFrontmatter(content);
      if (!fm.hasFrontmatter || fm.error) {
        fail(`${rel} missing or invalid YAML frontmatter${fm.error ? `: ${fm.error}` : ''}.`);
      } else {
        if (fm.data.name !== folder.name || !/^[a-z0-9-]+$/.test(String(fm.data.name || ''))) {
          fail(`${rel} frontmatter "name" ("${fm.data.name ?? ''}") must match folder "${folder.name}".`);
        }
        if (!String(fm.data.description || '').trim()) {
          fail(`${rel} frontmatter requires a non-empty "description".`);
        }
      }
      contextFiles.push({ absPath: skillPath, content, checkBacktickPaths: false });
    }
  }

  // 7. Syntax Hygiene, Markdown Links & Backtick Path Integrity across Context Files
  const knownPrefixes = /^(?:docs|src|tests|scripts|sidecars|skills|dist|bin|assets|\.agents|\.agent)\//;
  const knownRootFiles = new Set([
    'AGENTS.md',
    'DESIGN.md',
    'README.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'package.json',
    'tsconfig.json',
    'plugin.json',
    'hooks.json',
    'mcp_config.json',
    '.gitignore',
  ]);

  for (const file of contextFiles) {
    const rel = relFromRoot(file.absPath);
    const noFences = stripFencedCodeBlocks(file.content);
    const proseOnly = stripInlineCodeSpans(noFences);

    // Reject @[label](path) inlining syntax in prose
    const atInlineRe = /@\[[^\]]+\]\([^)]+\)/g;
    if (atInlineRe.test(proseOnly)) {
      fail(`${rel} contains forbidden "@[label](path)" pre-inlining syntax.`);
    }

    // Reject legacy pulse_hud sidecar URI (D-002)
    if (/sidecar:\/\/antigravity-pulse\/pulse_hud\b/.test(noFences)) {
      fail(`${rel} references legacy "sidecar://antigravity-pulse/pulse_hud"; use "sidecar://antigravity-pulse/pulse_cockpit/hud".`);
    }

    // Validate all Markdown links [label](target) outside inline code & fenced blocks
    const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let match;
    while ((match = linkRe.exec(proseOnly)) !== null) {
      const rawTarget = match[1];
      if (
        rawTarget.startsWith('http://') ||
        rawTarget.startsWith('https://') ||
        rawTarget.startsWith('mailto:') ||
        rawTarget.startsWith('sidecar://') ||
        rawTarget.startsWith('#')
      ) {
        continue;
      }

      stats.markdownLinksChecked += 1;
      const cleanTarget = rawTarget.split('#')[0].split('?')[0];
      if (!cleanTarget) continue;

      if (cleanTarget.startsWith('file://')) {
        try {
          const targetPath = fileURLToPath(cleanTarget);
          if (!existsSync(targetPath)) {
            fail(`${rel} has broken file:// link "${rawTarget}" (target does not exist).`);
          }
        } catch (err) {
          fail(`${rel} has malformed file:// link "${rawTarget}": ${err.message}`);
        }
        continue;
      }

      const resolved = path.resolve(path.dirname(file.absPath), cleanTarget);
      const relFromRepo = path.relative(REPO_ROOT, resolved);
      if (relFromRepo.startsWith('..') || path.isAbsolute(relFromRepo)) {
        fail(`${rel} links outside repository root: "${rawTarget}".`);
        continue;
      }
      if (!existsSync(resolved)) {
        fail(`${rel} has broken relative link "${rawTarget}" -> "${toPosix(relFromRepo)}" does not exist.`);
      }
    }

    // Validate backtick file paths in L1/L2/L3 workspace governance files
    if (file.checkBacktickPaths) {
      const inlineCodeRe = /`([^`\n]+)`/g;
      let codeMatch;
      while ((codeMatch = inlineCodeRe.exec(noFences)) !== null) {
        const token = codeMatch[1].trim();
        if (
          !token ||
          token.includes(' ') ||
          token.includes('*') ||
          token.includes('<') ||
          token.includes('>') ||
          token.includes('{') ||
          token.includes('$') ||
          token.endsWith('/') ||
          token.includes('://')
        ) {
          continue;
        }

        const isRepoPath = knownPrefixes.test(token) || knownRootFiles.has(token);
        if (!isRepoPath) continue;

        if (token.startsWith('.agent/')) {
          fail(`${rel} references forbidden legacy ".agent/" path "${token}".`);
          continue;
        }

        const absTarget = path.resolve(REPO_ROOT, token);
        if (existsSync(absTarget)) {
          stats.backtickPathsOnDisk += 1;
        } else if (!strictPaths && PLANNED_BLUEPRINT_PATHS.has(token)) {
          stats.backtickPathsPlanned += 1;
        } else {
          fail(
            `${rel} references missing/unknown path "\`${token}\`"${
              strictPaths ? ' (--strict-paths enabled)' : ' (not on disk and not in Blueprint §2 planned manifest)'
            }.`
          );
        }
      }
    }
  }

  const ok = errors.length === 0;
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          ok,
          strictPaths,
          stats,
          warnings,
          errors,
        },
        null,
        2
      )
    );
  } else {
    const summaryLine =
      `AGENTS.md=${stats.agentsBytes}B | rules=${stats.rulesCount} (alwaysOn=${stats.alwaysOnBytes}B) | ` +
      `skills=${stats.skillsCount} (+${stats.distributedSkillsCount} plugin) | ` +
      `links=${stats.markdownLinksChecked} | paths=${stats.backtickPathsOnDisk} on-disk, ${stats.backtickPathsPlanned} planned`;
    if (ok) {
      console.log(`[verify-context] PASS — ${summaryLine}`);
      for (const w of warnings) console.warn(`[verify-context] WARN: ${w}`);
    } else {
      console.error(`[verify-context] FAIL (${errors.length} error(s)) — ${summaryLine}`);
      for (const err of errors) console.error(`  - ${err}`);
      for (const w of warnings) console.warn(`  - WARN: ${w}`);
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
