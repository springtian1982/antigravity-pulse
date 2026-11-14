# 本地开发、测试与贡献指南

欢迎参与 `antigravity-pulse` 的开发与改进！本文档说明项目的开发环境要求、工程质量红线、测试规范以及提交贡献流程。

---

## 1. 开发环境准备

- **Node.js**：`>= 20.0.0`（推荐使用 Node 20 或 22 LTS）。
- **包管理器**：`npm`。
- **可选验证工具**：
  - [`agy-pele`](https://github.com/springtian1982/antigravity-pele)：用于执行 `agy-pele check . --strict-mermaid` 校验仓库内所有 Markdown 图表语法与 GitHub 渲染兼容性。
  - `agy`（Google Antigravity CLI）：用于执行 `agy plugin validate . --strict` 校验插件清单结构。

克隆并初始化本地开发环境：

```bash
git clone https://github.com/springtian1982/antigravity-pulse.git
cd antigravity-pulse
npm install
```

---

## 2. 研发脚本约定

与姊妹仓库 `antigravity-pele` 保持一致的工程脚本规范：

| 命令 | 说明 |
| :--- | :--- |
| `npm run build` | 通过 `scripts/build.mjs` (`esbuild`) 编译 CLI、MCP、Hook 探针与 Sidecar 前后端产物，自动注入 SPDX MIT 版权头 |
| `npm run typecheck` | 执行 `tsc --noEmit` 进行全量 TypeScript 严格类型检查 |
| `npm test` | 构建产物并使用 Node.js 原生 `node:test` 运行端到端单元测试 |
| `npm run install:global` | 通过 `scripts/install.mjs` 执行原子覆盖安装（保持运行中 Sidecar/MCP 进程目录 inode 有效）并创建 `agy-pulse` 启动链接 |

---

## 3. 核心工程质量红线

1. **Hook 探针冷启动耗时 `< 8ms`**：
   - `dist/hook-probe.cjs` 保持零重型依赖，严禁在同步 Hook 路径内发起网络请求或全盘目录扫描。
2. **预构建单文件开箱即用**：
   - 终端用户克隆仓库后无需执行 `npm install` 或 TypeScript 编译即可直接运行 `node scripts/install.mjs`，所有运行时产物均需内联打包（`sidecar_sdk` 标记为 `external` 由宿主加载器提供）并附带完整 SPDX 许可注释头。
3. **跨平台路径与编码安全**：
   - 所有文件路径转换与启动垫片必须同时覆盖 POSIX（Linux）与 Windows（`CRLF`、`cmd` / `ps1` 启动器、`agy-node.exe` 回退）。
4. **文档图表兼容性**：
   - 仓库内所有 `.md` 文件中的 ```` ```mermaid ```` 代码块必须严格遵循标准 Mermaid 12.1 语法，确保在 GitHub、GitLab 与 Obsidian 中均可原生渲染。

---

## 4. 提交 PR 前的检查清单

```bash
# 1. TypeScript 严格类型检查
npm run typecheck

# 2. 构建并执行全部自动化测试
npm test

# 3. 校验仓库所有 Markdown 中的 Mermaid 语法（必须 0 error, 0 warning）
agy-pele check . --strict-mermaid

# 4. Antigravity 插件结构校验（若本地已安装 agy CLI）
agy plugin validate . --strict --json
```

---

## 5. 开源协议

向本项目提交贡献即表示你同意你的贡献将在项目的 **[MIT License](../../LICENSE)** 下发布，并保留原作者版权声明（`Copyright (c) 2026 springtian <springtian@gmail.com>`）。
