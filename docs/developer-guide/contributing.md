# 本地开发、测试与贡献指南

欢迎参与 `antigravity-pulse`（`Model Pulse` / `agy-pulse`）的开发与演进！本文档汇总本地开发环境准备、标准研发脚本、核心架构决策（`D-001`–`D-010`）、实证防坑红线（`L-001`–`L-021`）以及提交 Pull Request 前的强制门禁清单。

---

## 1. 开发环境准备

- **Node.js**：`>= 20.0.0`（推荐 Node 20 / 22 / 24 LTS）。
- **包管理器**：`npm`（仅用于安装开发期 `typescript`、`esbuild` 与 `@types/node`；运行时产物保持 100% 零外部 `npm` 依赖）。
- **治理与校验工具**：
  - [`agy-pele`](https://github.com/springtian1982/antigravity-pele)：执行 `agy-pele check . --strict-mermaid` 校验仓库内全部 Markdown 文件的 Mermaid 12.1 标准语法。
  - `agy`（Google Antigravity CLI）：执行插件清单与零 `rules/` 组件卫生校验。

克隆并初始化本地开发环境：

```bash
git clone https://github.com/springtian1982/antigravity-pulse.git
cd antigravity-pulse
npm install
```

---

## 2. 研发与验证脚本一览

所有命令均在仓库根目录下运行：

| 命令 | 说明 |
| :--- | :--- |
| `npm run typecheck` | 执行 `tsc --noEmit` 进行全量 TypeScript 严格静态类型检查（`strict: true`） |
| `npm run build` | 通过 `scripts/build.mjs`（`esbuild`）编译全部 5 个预构建单文件产物（`dist/hook-probe.cjs`、`dist/mcp.cjs`、`dist/cli.cjs`、`sidecars/pulse_cockpit/dist/server.mjs`、`sidecars/pulse_cockpit/dist/ui.js`），自动注入 SPDX MIT 版权头并将 `sidecar_sdk` 标记为 `external` |
| `npm test` | 先构建产物并通过 `scripts/build-tests.mjs` 将 `tests/**/*.test.ts` 扁平化编译至 `.test-dist/<subpath>--<name>.test.cjs`（`L-010`），随后分两阶段运行 `node:test`：先并行跑完 **108 项**单元/契约/E2E 功能测试，再独立顺序执行 **2 项**双指标校准 Hook 延迟基准测试（`D-009` / `D-010`） |
| `npm run preview` | 启动 `scripts/preview-ui.mjs` 独立本地预览服务（支持 `--port 0` 随机端口、`?scenario=...` 多场景与 `?theme=light\|dark` 主题强制切换，`L-012` / `L-015`） |
| `npm run verify:context` | 运行零依赖 `scripts/verify-context.mjs`（提交前推荐加 `--strict-paths` 参数校验所有反引号路径 100% 落盘） |
| `npm run install:global` | 通过 `scripts/install.mjs` 执行保 inode 原子全局安装（`D-006`），同步 `~/.gemini/config/plugins/antigravity-pulse` 与 `agy-pulse` 启动链接 |

---

## 3. 核心架构决策与工程红线（`D-001`–`D-010` & `L-001`–`L-021`）

修改代码前请务必阅读 [总控实现蓝图](../plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md)、[架构决策日志 (`DECISION_LOG.md`)](../plans/DECISION_LOG.md) 与 [实证避坑台账 (`LESSONS_LEARNED.md`)](../plans/LESSONS_LEARNED.md)：

### 3.1 关键架构不变量（`D-001`–`D-010`）

1. **四阶段模块化架构与契约冻结（`D-001`）**：跨模块共享契约集中在 `src/types/telemetry.ts`、`src/types/rpc.ts` 与 `$PULSE_STATE_DIR` JSON 结构；任何契约变更必须先在 `DECISION_LOG.md` 记录 `[CONTRACT_CHANGE_REQUEST]`。
2. **统一 Sidecar URI 与单进程双入口（`D-002`）**：所有深链接统一使用 `sidecar://antigravity-pulse/pulse_cockpit/hud`（严禁使用旧名 `pulse_hud`），`server.mjs` 将 `/` 别名映射至 `/hud`。
3. **`$PULSE_STATE_DIR` 原子状态总线（`D-003`）**：跨进程共享只通过 `0700`/`0600` 原子 `tmp + renameSync` 快照与 `O_APPEND` 环形日志完成，严禁扫描 `/proc` 或探测未知端口。
4. **零 OpenSSL 探针与双指标顺序基准校准（`D-004`、`D-009`、`D-010`）**：`dist/hook-probe.cjs` 严禁引入 `node:crypto`（`! grep -q "node:crypto" dist/hook-probe.cjs`）、严禁网络 I/O；`npm test` 保持功能测试并行、基准测试独立顺序运行，严格断言进程内 JS `<= 8.0ms` 且配对裸 V8 冷启动增量 `pairedDelta <= 20.0ms`（总耗时 `<= max(50ms, bareNode+20ms)` 且 `<= 100ms`）。
5. **预构建产物纳入 Git 追踪（`D-005`）**：**严禁**将 `dist/` 或 `sidecars/pulse_cockpit/dist/` 加入 `.gitignore`；每次修改 `src/` 后必须运行 `npm run build` 并将更新后的预构建产物一并提交。
6. **保 inode 原子安装器（`D-006`）**：`scripts/install.mjs` 必须通过同目录临时文件 + `renameSync` 覆盖更新，严禁对运行中插件目录执行 `fs.rmSync`。
7. **零闲置 Token 插件卫生（`D-007`）**：严禁创建插件根目录 `rules/`，严禁把工作区专用的 `AGENTS.md` 或 `.agents/` 加入 `package.json` `"files"`；发行插件仅包含按需触发的 `skills/model-pulse/SKILL.md`（且技能文档字段受 `tests/contracts/manifest-contracts.test.ts` 回归锁定，`L-021`）。
8. **宿主主题融合与无障碍对比度（`D-008`）**：`styles.css` 在绑定宿主 `--background`/`--foreground` 变量的同时通过 `body` `!important` 覆盖 `preload.js` 的 `#fafafa` 内联回退，所有 5 档 Flexoki 胶囊文本满足 WCAG `>= 4.5:1` 对比度。

### 3.2 高频实证防坑速查（`L-001`–`L-021` 摘要）

- **RPC 与拓扑解析（`L-001`–`L-005`、`L-021`）**：`usage.*` 64 位整数字段在 JSON 线上为字符串，必须经统一有限非负数转换（`L-001`）；缓存命中率分母必须为 `inputTokens + cacheReadTokens`（`L-002`）；正常未重试调用的 `retryInfos.length === 1`，重试次数必须按 `Math.max(0, len - 1)` 计算（`L-003`）；`GetCascadeTrajectorySteps` 仅对 `RUNNING` 会话调用且必须传 `stepOffset` + `disableRehydration: true`（`L-004`）；`swarm/members.json` 的 `members` 是对象字典而非数组（`L-005`）；未映射的 `MODEL_PLACEHOLDER_*` 请求枚举在路由对账中不得误判为 `mismatch_or_fallback`（`L-021`）。
- **宿主协议与构建/测试隔离（`L-006`–`L-010`、`L-013`、`L-017`）**：`hooks.json` 必须保留 `"pulse-telemetry"` 顶层包装与分组/扁平非对称结构，且 `PreToolUse` 始终输出 `{"decision":"allow"}`（`L-006`）；`SidecarApp` 页面与 HTTP `400` 校验错误必须显式返回 `new Response(...)`（`L-007`）；CLI/Hook/MCP 入口自启动判断必须同时校验 `require.main === module` 与入口文件名正则，防止 `esbuild` 单测打包误触发（`L-013`）；子进程单测与 E2E 必须清理宿主 `ANTIGRAVITY_*` 环境变量并在 `--watch` 文件变更断言前关闭并发 Sidecar 轮询（`L-017`）。
- **窄视口 CSS 与终端宽字符（`L-011`、`L-012`、`L-014`–`L-016`、`L-018`、`L-019`）**：`360px` `AUX_PANE`、`/fleet` 展开抽屉与 `440px` `<agent-embed>` 卡片必须通过内层块级文本或 `inline-block` `.pill` 实现省略号并保护类别徽章 `flex: 0 0 auto`；`top-tui.ts` 必须使用 `codePointDisplayWidth` 处理中文/Emoji 双列宽，并支持非 TTY 下读取 `COLUMNS`/`LINES`（`L-018`）。

---

## 4. 提交 PR 前的完整验证门禁清单

请在提交代码或发起 PR 前依次运行并通过以下全部门禁：

```bash
# 1. TypeScript 严格静态类型检查
npm run typecheck

# 2. 重新编译 5 个预构建单文件产物并确认 Hook 探针零 node:crypto 引入
npm run build
! grep -q "node:crypto" dist/hook-probe.cjs

# 3. 运行全量测试套件（108 项功能测试 + 2 项顺序校准 Hook 延迟基准测试）
npm test

# 4. 校验三层上下文治理预算、YAML 头、.gitignore (D-005)、零 rules/ (D-007)、链接与全路径落盘
node scripts/verify-context.mjs --strict-paths

# 5. 校验全仓 Markdown 中的标准 Mermaid 12.1 语法（必须 0 error(s), 0 warning(s)）
agy-pele check . --strict-mermaid

# 6. Antigravity 插件清单校验
# 6a. 仓库根目录（0 errors，components.rules === 0；仅根 AGENTS.md 产生 1 条预期的非插件规则提示，见 L-008）
agy plugin validate . --json

# 6b. 保 inode 原子全局安装后，对纯净发行目录执行严格校验（必须 findings: []，0 errors, 0 warnings）
npm run install:global
agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json
agy-pulse doctor
```

---

## 5. 开源协议

向本项目提交贡献即表示你同意你的贡献将在项目的 **[MIT License](../../LICENSE)** 下发布，并保留原作者版权声明（`Copyright (c) 2026 springtian <springtian@gmail.com>`）。
