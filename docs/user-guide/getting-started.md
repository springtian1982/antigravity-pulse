# 快速上手与四大形态全指南

本文档详细介绍 `antigravity-pulse`（展示名：**Model Pulse**，命令行：**`agy-pulse`**）在 **Google Antigravity 2.0**（Linux & Windows）中的零依赖安装部署、四大观测形态实操、`agy-pulse` CLI 全量参数、MCP 工具契约以及 `$PULSE_STATE_DIR/config.json` 配置项。

---

## 1. 运行环境与零依赖安装

### 1.1 运行环境要求

- **宿主应用**：Google Antigravity 2.0 Desktop App（Linux 或 Windows）。
- **JavaScript 运行时**：
  - 优先使用系统 `PATH` 中的 `node`（推荐 Node.js `>= 20`）；
  - 若目标机器未全局安装 Node.js，安装器与 `bin/agy-pulse*` 启动垫片会自动探测并回退至 Antigravity 内置的 `agy-node`（Linux：`~/.config/Antigravity/bin/agy-node`）或 `agy-node.exe`（Windows：`%APPDATA%\Antigravity\bin\agy-node.exe` / `%LOCALAPPDATA%\Programs\Antigravity\bin\agy-node.exe`）。

### 1.2 一键原子安装与无感升级

仓库已预构建并提交全部 5 个零外部依赖运行时单文件产物（`D-005`），克隆后**无需运行 `npm install`** 即可直接安装：

```bash
git clone https://github.com/springtian1982/antigravity-pulse.git
cd antigravity-pulse

# 执行保 inode 原子安装（升级时不会中断已运行的 Sidecar / MCP 进程，D-006）
node scripts/install.mjs
# 等价 npm 脚本：npm run install:global
```

安装完成后会就位以下组件（遵循 `D-007` 零 Token 插件卫生原则，绝不向插件目录写入 `rules/`）：

| 平台 | 插件安装目录 | 全局 CLI 启动入口 |
| :--- | :--- | :--- |
| **Linux** | `~/.gemini/config/plugins/antigravity-pulse` | `~/.local/bin/agy-pulse`（指向插件 `bin/agy-pulse` 的符号链接，请确保 `~/.local/bin` 在 `PATH` 中） |
| **Windows** | `%USERPROFILE%\.gemini\config\plugins\antigravity-pulse` | `%LOCALAPPDATA%\Microsoft\WindowsApps\agy-pulse.cmd`（调用 `bin\agy-pulse.cmd`，同时提供 PowerShell 辅助脚本 `bin\agy-pulse.ps1`） |

安装脚本还支持可选参数：`node scripts/install.mjs [--target-dir <dir>] [--bin-dir <dir>] [--node-path <exe>] [--force-patch]`。

> **升级热重载说明（`D-011` / `L-022`）**：当前版本 `pulse_cockpit` Sidecar 内置 `3s` 产物签名自检（`watchBundleForRestart`），后续执行 `npm run install:global` 覆盖更新后会在约 `3.4s` 内自动优雅退出并由宿主拉起新版本。若你是从早期未内置自检的旧版驻留进程首次升级，可执行一次插件重开命令完成切换：
> ```bash
> agy plugin disable antigravity-pulse && agy plugin enable antigravity-pulse
> ```

安装后可立即执行五维环境自检：

```bash
agy-pulse doctor
```

确认 `runtime`、`state_dir`、`host_ls`、`plugin_install`、`launcher_link` 五项检查状态正常。

---

## 2. 四大核心观测形态使用指南

### 2.1 右侧会话伴随舱：`Pulse HUD` (`/hud` · `AUX_PANE`) 与调用火焰轴 (`Timeline`)

在 Antigravity 聊天面板右上角视图菜单（或 `Extensions ➔ Model Pulse`）中打开 **Model Pulse** 右侧辅助舱，或直接点击聊天内联微章 / MCP 回复中的 `[Model Pulse](sidecar://antigravity-pulse/pulse_cockpit/hud)` 胶囊（`D-002` 标准 URI）：

1. **吸顶主会话脉冲栏（Sticky Hero Card）**：
   - **子会话面包屑导航**：切入子代理会话时顶部显示 `Root ➔ Subagent` 路径及一键返回父会话按钮。
   - **7 态实时阶段秒表与速率**：动态区分 `PRE_FLIGHT`、`THINKING`（读秒计时，告别 15s–65s 深度思考“假死焦虑”）、`STREAMING`（实时 `tok/s`）、`TOOL_RUNNING`（当前工具名与摘要）、`BLOCKED_APPROVAL`、`ERROR_OR_QUOTA` 与 `IDLE`。
   - **`Requested ➔ Served` 双层路由核验铭牌**：自动反解 `MODEL_PLACEHOLDER_*`，直观对比请求配置与真实响应模型（如 `Auto ➔ Gemini 4 Carbon (High) [HIGH]`），并在发生 `429` 退避重试时亮起 `Retry ×N` 警示胶囊。
   - **上下文水位与缓存健康条**：实时监控 `CTX` 窗口占用率（`> 70%` 琥珀色预警，`> 85%` 珊瑚红告警，提醒及时 `/compact`）与 **Prompt Cache 命中率**。
2. **并发智能体矩阵（Live Agent Tree & Swarm Matrix）**：
   - 支持在 **`Active-First`（活跃置顶）** 与 **`Topology-Tree`（父子缩进树）** 两种排序视图间切换。
   - 自动融合当前会话派生的多级 `invoke_subagent`、`run_workflow` 与原生 `Swarm` 成员，展示各自真实模型、阶段、工具动作与单节点 `ΔQuota%`；点击右侧 **`[↗]`** 即可调用 `window.sidecar.ui.toggleConversation(cid)` 直达对应子会话。
   - **Smart Governance Banner**：当同一会话树并发运行 `>= 3` 个高算力（`apex`）节点且 Gemini 5h 剩余配额 `< 40%` 时，自动弹出配额治理提示。
3. **轮次调用火焰轴（`Timeline` 页签）**：
   - 支持切换 **`Current Session`（`conversation` 单会话）** 与 **`Cascade Tree`（`tree` 整棵派生树）** 作用域。
   - 按时间倒序渲染每一轮模型调用的 **紫色 `TTFT`（首字思考等待耗时）+ 青色 `Streaming`（流式生成耗时）** 双段比例条、Thinking Token 占比（%）、跨轮切模标记及重试徽章。
4. **底部常驻配额油量表（Quota Fuel Bar）**：
   - 常驻展示 Gemini `5h` / `Weekly` 与 Claude/第三方 `5h` 配额余量百分比、重置倒计时（如 `3h 42m`）以及当前会话树累计净消耗 `ΔQuota%`。

### 2.2 聊天流零 Token 内联微章：`Inline Turn Stamp` (`hooks.json`)

无需常开右侧边栏，也能在主会话及子代理聊天气泡流中直接获知真实模型与异常状态：

| 模式名称 | 触发条件 | LLM Token 开销 | 推荐场景 |
| :--- | :--- | :--- | :--- |
| **`smart`（默认）** | 仅在 **(1) 会话首轮响应**、**(2) 实际服务模型发生切换**、**(3) 发生重试（`retryInfos.length > 1`）或路由回退**、**(4) 上下文 `> 75%`**、或 **(5) 5h 配额 `< 20%`** 时输出单行微章（按轮次去重） | **0 Token**（`systemMessage: ""` + `metadata.user_markdown`，100% 保护 Prompt Cache） | 日常主力研发，兼顾清爽与关键变迁感知 |
| **`every-turn`** | 每一轮模型调用完成后均输出包含真实模型、TTFT、Cache 命中率与配额余量的单行微章 | **0 Token** | 模型评测、路由核验与性能基准调优 |
| **`off`** | 完全不在聊天流注入内联步骤，仅通过 `/hud`、`/fleet`、MCP 与 CLI 观测 | **0 Token** | 极致纯净聊天界面偏好者 |

### 2.3 左侧全局舰队监控台：`Pulse Fleet` (`/fleet` · `SIDEBAR`)

在 Antigravity 左侧扩展/活动栏（`Extensions ➔ Model Pulse ➔ Pulse Fleet`）点击打开 **Pulse Fleet** 侧边栏，跨所有打开的工作区（Projects）全局掌控后台算力：

- **全局活跃算力头条**：实时统计本机正在运行的 Root 会话数、活跃 Subagent/Swarm 总数以及各模型档位并发分布直方图（如 `Carbon(H) ×2 · Argon(M) ×3 · Flash ×2`）。
- **按项目分组的活跃会话树**：展示所有后台运行任务（含 `/goal` 与 `/schedule`），点击展开抽屉即可检视子代理列表并点击 **`[↗]`** 一键跳转。
- **Top 5 配额消耗榜（Top 5 Quota Burners）**：按当前 5 小时滚动窗口内的真实配额净扣减（`Δ5h%`）与累计 Token 消耗列出前 5 名会话树。

---

## 3. `agy-pulse` 命令行工具参考

`agy-pulse` 直接读取 `$PULSE_STATE_DIR` 原子快照总线（耗时 `< 2ms`），并支持在传入 `--live`（或快照过期且当前终端具备宿主 `ANTIGRAVITY_LS_ADDRESS` / `ANTIGRAVITY_CSRF_TOKEN` 环境变量时）执行只读 Connect-RPC 即时刷新。

### 3.1 `agy-pulse status` — 系统状态栏与流式遥测

```bash
agy-pulse status [--format <waybar|tmux|json|text>] [--watch] [--interval <ms>] [--conversation <uuid>] [--live] [--state-dir <path>]
```

- `--format <waybar|tmux|json|text>`（短选项 `-f`，默认 `text`）：
  - `waybar`：输出符合 Waybar 自定义模块规范的单行 JSON（`{ text, tooltip, class, percentage }`）。
  - `tmux`：输出带 Flexoki 模型梯队色彩标签并自动转义 `#`/`[`/`]` 的单行状态串。
  - `json`：输出完整结构化 `CliStatusJsonPayload`（`schemaVersion: 1`）。
  - `text`：输出适合终端阅读的单行紧凑摘要。
- `--watch`（短选项 `-w`）：基于 `fs.watch`（50ms 防抖）+ 轮询兜底持续监听状态变化，**仅当输出签名实际变化时**推流新行。
- `--interval <ms>`：兜底轮询间隔毫秒数（默认 `1000`，最小值 `200`）。
- `--conversation <uuid>`：指定观测特定 36 位会话 UUID。
- `--live`：若存在宿主 LS 环境变量，强制发起只读 RPC 实时拉取。
- `--state-dir <path>`：覆盖默认 `$PULSE_STATE_DIR` 路径。

**Linux Waybar 配置示例（`~/.config/waybar/config.jsonc`）**：

```json
"custom/agy-pulse": {
  "exec": "agy-pulse status --format waybar --watch",
  "return-type": "json",
  "restart-interval": 5
}
```

**tmux 配置示例（`~/.tmux.conf`）**：

```tmux
set -g status-interval 2
set -g status-right '#(agy-pulse status --format tmux) | %H:%M'
```

### 3.2 `agy-pulse top` — 终端实时多智能体监视器

```bash
agy-pulse top [--interval <ms>] [--once] [--conversation <uuid>] [--sort <active-first|topology-tree>] [--no-color] [--live] [--state-dir <path>]
```

- 默认在交互式 TTY 下进入备用屏幕（Alternate Screen），支持中日韩（CJK）与宽字符精确列宽对齐：
  - 交互快捷键：`q` / `Ctrl+C` 退出 · `r` 立即刷新 · `s` 切换 `active-first` / `topology-tree` 排序 · `j`/`↓` 与 `k`/`↑` 上下滚动节点列表。
- `--once`：渲染单帧完整面板后立即以退出码 `0` 结束（管道或非 TTY 输出时亦自动启用单帧模式，并支持通过 `COLUMNS` / `LINES` 环境变量指定终端尺寸）。
- `--interval <ms>`：刷新周期毫秒数（默认 `1000`，最小值 `250`）。
- `--sort <active-first|topology-tree>`：覆盖本次会话的节点排序策略。
- `--no-color`：禁用 ANSI 颜色转义序列（同样遵循标准 `NO_COLOR` 环境变量）。
- `--conversation <uuid>` / `--live` / `--state-dir <path>`：同 `status`。

### 3.3 `agy-pulse config` — 偏好查询与原子更新

```bash
# 查看完整配置 JSON 或读取单个点分键（如 smartThresholds.contextWarnPct）
agy-pulse config get [key] [--state-dir <path>]

# 校验合法范围并原子写入单个配置项
agy-pulse config set <key> <value> [--state-dir <path>]

# 恢复内置默认配置
agy-pulse config reset [--state-dir <path>]

# 打印当前生效的 config.json 绝对路径
agy-pulse config path [--state-dir <path>]
```

常用示例：

```bash
agy-pulse config set inlineStampMode every-turn
agy-pulse config set hudSortMode topology-tree
agy-pulse config set smartThresholds.quotaLowTriggerPct 25
```

### 3.4 `agy-pulse doctor` — 五维非破坏性健康诊断

```bash
agy-pulse doctor [--json] [--state-dir <path>]
```

逐项检查：`runtime`（Node 版本）、`state_dir`（目录权限与原子写探针并自动清理）、`host_ls`（只读 Connect-RPC 连通性或离线缓存状态）、`plugin_install`（9 个必需发行文件完整性与零 `rules/` 校验）、`launcher_link`（`PATH` 中的 `agy-pulse` 可执行状态）。

---

## 4. MCP 工具集与智能体自适应算力治理

插件内置零外部依赖 MCP 服务 `antigravity-pulse`（`dist/mcp.cjs`）与按需加载技能 `skills/model-pulse/SKILL.md`。在对话中通过 `@` 引用或自然语言要求 Agent 展示遥测卡片、自检配额预算时，Agent 可直接调用以下工具：

1. **`pulse_status_card`**（参数：`{ conversationId?, theme?: "auto" | "light" | "dark", includeTree?: boolean }`）：
   - 在 `$PULSE_STATE_DIR/cards/` 下生成内联样式、无外部请求、抗 XSS 的自适应 Flexoki HTML 快照卡。
   - 返回 `embedTag`（直接嵌入回复的 `<agent-embed src="file:///..."></agent-embed>` 标签）、`sidecarPill`（`[Model Pulse](sidecar://antigravity-pulse/pulse_cockpit/hud)`）、`summary`、`hostConnected`、`stale` 与 `nodeCount`。
2. **`pulse_get_compute_budget`**（参数：`{ conversationId?, plannedSubagentCount?, taskKind?: "exploration" | "coding" | "review" | "general" }`）：
   - 在派生并行子代理或 Swarm 前评估实时配额与上下文水位，返回 `ComputeBudgetAdvice`：
     - `recommendedSubagentModel`：`"inherit" | "argon" | "flash"`（例如当 Gemini 5h 配额 `< 25%`、并发 `apex >= 3` 且配额 `< 40%`、或 `exploration` 任务配额 `< 45%` 时自动建议降档为 `"flash"`；`25%..45%` 常规任务建议 `"argon"`；`>= 45%` 建议 `"inherit"`）。
     - 同时返回 `activeModel`、`contextWindowPct`、`quota`、`reason` 与 `warnings`（当 `contextWindowPct > 85%` 时提示先压缩上下文）。
3. **`pulse_set_preference`**（参数：`{ inlineStampMode?, hudSortMode?, timelineScope?, smartThresholds? }`）：
   - 通过自然语言指令直接原子持久化修改 Model Pulse 配置。

---

## 5. `$PULSE_STATE_DIR/config.json` 配置参考

状态目录按以下优先级解析：`ANTIGRAVITY_PULSE_STATE_DIR` ➔ `PLUGIN_DATA` ➔ `<ANTIGRAVITY_APP_DATA_DIR || ANTIGRAVITY_DATA_DIR || ~/.gemini/antigravity>/plugin_data/antigravity-pulse`（默认 `~/.gemini/antigravity/plugin_data/antigravity-pulse`，与宿主 `PLUGIN_DATA` 完全对齐，`D-011`；目录权限 `0700`，JSON 文件权限 `0600`）。

| 配置键路径 | 类型 / 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `inlineStampMode` | `"smart" \| "every-turn" \| "off"` | `"smart"` | 聊天流零 Token 内联微章触发策略 |
| `hudSortMode` | `"active-first" \| "topology-tree"` | `"active-first"` | `Pulse HUD` 与 `agy-pulse top` 默认节点排序模式 |
| `timelineScope` | `"conversation" \| "tree"` | `"tree"` | `Timeline` 火焰轴默认统计范围（单会话 vs 整棵会话树） |
| `smartThresholds.contextWarnPct` | `number` (`1..100`) | `70` | 上下文进度条切换琥珀色预警阈值（%） |
| `smartThresholds.contextCriticalPct` | `number` (`1..100`) | `85` | 上下文进度条切换珊瑚红危急阈值（%） |
| `smartThresholds.stampContextTriggerPct` | `number` (`1..100`) | `75` | `smart` 模式下触发上下文高水位内联微章阈值（%） |
| `smartThresholds.quotaLowTriggerPct` | `number` (`1..100`) | `20` | `smart` 模式下触发 5h 低配额内联微章阈值（%） |
| `smartThresholds.heavyConcurrentAlertCount` | `integer` (`1..100`) | `3` | 激活 Smart Governance 横幅所需的并发 `apex` 节点数 |
| `smartThresholds.heavyQuotaThresholdPct` | `number` (`1..100`) | `40` | 激活 Smart Governance 横幅的 5h 配额上限阈值（%） |
| `pollIntervalsMs.active` | `number` (`50..3600000`) | `1000` | 存在运行中会话时 Sidecar 轮询周期（ms） |
| `pollIntervalsMs.idle` | `number` (`50..3600000`) | `3000` | 全局空闲期 Sidecar 轮询周期（ms） |
| `pollIntervalsMs.quota` | `number` (`50..3600000`) | `30000` | 配额桶周期性刷新间隔（ms，轮次完成时亦按需刷新） |
| `pollIntervalsMs.modelConfig` | `number` (`50..3600000`) | `30000` | 模型目录（`GetCascadeModelConfigData`）刷新间隔（ms） |

---

## 6. 数据隐私与只读安全承诺

- **100% 本地回环运行**：Sidecar Web 服务严格绑定 `127.0.0.1`，绝不发起任何公网请求或上传用户 Prompt、会话标题与遥测数据。
- **100% 只读会话观测**：底层硬性锁定 5 个只读 Connect-RPC 接口与 `file:...?mode=ro` 只读数据库访问，绝不修改、删除任何会话轨迹或篡改 `app.asar`（详见 [系统架构与内部原理](../developer-guide/architecture.md)）。
