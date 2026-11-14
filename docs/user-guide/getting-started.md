# 快速上手与四大形态指南

本文档介绍 `antigravity-pulse`（展示名：**Model Pulse**，CLI：**`agy-pulse`**）在 **Google Antigravity 2.0**（Windows & Linux）中的运行环境要求与四大核心观测形态。

> **项目当前状态**：仓库已完成底层协议实证与产品架构基线锁定（见 [PRODUCT_DESIGN.md](../PRODUCT_DESIGN.md)），Phase 1 MVP 正在构建中。以下为目标交付形态的使用与配置规范。

---

## 1. 运行环境要求

- **宿主应用**：Google Antigravity 2.0 Desktop App（Linux 或 Windows）。
- **运行时支持**：
  - 插件安装脚本与 CLI 启动器会优先使用系统 `PATH` 中的 `node`（推荐 Node.js `>= 20`）；
  - 若目标机器未全局安装 Node.js，启动垫片会自动回退至 Antigravity 内置的 `agy-node` / `agy-node.exe`，无需额外配置编译工具链。

---

## 2. 四大观测形态一览

### 2.1 右侧会话伴随舱：`Pulse HUD` (`AUX_PANE`)

在聊天顶部面板菜单或通过对话中的 `[Model Pulse](sidecar://antigravity-pulse/pulse_cockpit/hud)` 胶囊打开右侧面板：

- **一眼识别主会话真实模型**：同时显示用户配置意图与后端真实响应模型（如 `Auto ➔ Gemini 4 Argon [MED]` 或 `Gemini 4 Carbon [HIGH] ✓ gemini-4-carbon`）。
- **告别长思考“假死焦虑”**：当高推理档位模型处于 `15s–65s` 首字等待期时，顶部秒表动态显示 `🟣 Thinking · 18.4s`。
- **掌控所有并发子代理与 Swarm**：自动列出当前会话派生出的全部多级 Subagents、Workflow 节点与 Swarm 成员，实时展示各自模型档位、当前工具动作摘要及单树配额消耗，点击 **`[↗]`** 一键切入对应子会话。
- **监控上下文水位与配额余量**：实时查看 `256k` 上下文占用比例、Prompt Cache 命中率以及 Gemini / Claude 5h 与 Weekly 配额剩余百分比。

### 2.2 聊天流零 Token 内联微章：`Inline Turn Stamp`

无需常开右侧边栏，也能在主会话及子代理聊天气泡中直观获知模型动态：

| 模式名称 | 触发时机 | 模型侧 Token 开销 | 适用人群 |
| :--- | :--- | :--- | :--- |
| **`smart`（默认）** | 仅在会话首轮响应、中途实际模型发生切换、或出现 429 重试 / 上下文 `>75%` / 5h 配额 `<20%` 时插入单行回执 | **0 Token**（不影响 Prompt Cache） | 绝大多数日常研发场景 |
| **`every-turn`** | 每一次模型调用完成后均展示紧凑遥测微章（含 TTFT、Cache 命中率与配额余量） | **0 Token** | 模型评测、路由对比与性能调优 |
| **`off`** | 完全不在对话流注入任何步骤，仅通过右侧 `Pulse HUD`、左侧 `Pulse Fleet` 与 CLI 展示 | **0 Token** | 极致纯净聊天流偏好者 |

### 2.3 左侧全局舰队监控台：`Pulse Fleet` (`SIDEBAR`)

点击应用左侧导航栏的 **Pulse Fleet** 图标，跨所有打开的 Projects 查看：
- 当前正在后台并发运行的全部主会话、Subagents、`/goal` 长时任务与 `/schedule` 定时任务；
- 全局活跃模型并发分布（如 `Carbon(H) ×2 · Argon(M) ×3 · Flash ×2`）；
- 当前 5 小时滚动窗口内的 **Top 配额消耗会话榜**。

### 2.4 跨平台命令行与系统状态栏：`agy-pulse` CLI

面向终端分屏与 Linux 桌面状态栏（Waybar / Polybar / tmux）用户：

```bash
# 终端实时交互式多智能体算力监控面板
agy-pulse top

# 输出适用于 Waybar / tmux 状态栏的实时单行流
agy-pulse status --format waybar --watch
```

---

## 3. 数据隐私与安全承诺

- **100% 本地回环运行**：Sidecar 服务仅绑定 `127.0.0.1` 本地回环地址，绝不向任何外部网络上报会话标题、Prompt 或遥测数据。
- **100% 只读会话观测**：插件仅以只读方式查询本地 Language Server 状态与会话元数据，绝不修改或删除任何用户会话记录。
