# Antigravity Pulse 文档中心

欢迎查阅 **Antigravity Pulse (`antigravity-pulse` / `Model Pulse` / `agy-pulse`)** 文档库。文档按读者角色分为**产品与用户指南**与**开发者与架构文档**两条路径。

```mermaid
flowchart TD
  Hub["Antigravity Pulse 文档中心"]
  Hub --> Product["产品规范与用户指南"]
  Hub --> Devs["开发者与架构文档"]

  Product --> P1["1. 产品设计与技术实证全案<br/>(PRODUCT_DESIGN.md)"]
  Product --> U1["2. 快速上手与四大形态指南<br/>(user-guide/getting-started.md)"]

  Devs --> D1["1. 系统架构与内部原理<br/>(developer-guide/architecture.md)"]
  Devs --> D2["2. 本地开发、测试与贡献<br/>(developer-guide/contributing.md)"]
```

---

## 产品规范与普通用户指南（Product & User Guide）

如果你希望了解 `antigravity-pulse` 解决的核心痛点、四大交互触点（右侧 `Pulse HUD`、零 Token 聊天微章、左侧 `Pulse Fleet`、`agy-pulse` CLI）以及安装配置方式，请从这里开始：

| 文档 | 内容摘要 | 适合场景 |
| :--- | :--- | :--- |
| [产品设计与技术实证文档](PRODUCT_DESIGN.md) | 五大深层意图（JTBD）推导、Connect-RPC 与五层存储实测验证、UI/UX 模块详设、视觉色板与已锁定决策 | 全面理解产品设计哲学与完整功能边界 |
| [快速上手与使用指南](user-guide/getting-started.md) | Windows / Linux 环境要求、四大形态使用方式、内联微章三档策略（`smart` / `every-turn` / `off`）说明 | 日常观测主从活跃模型与监控配额 |

---

## 面向开发者与贡献者（Developer Guide）

如果你计划参与 Phase 1–3 核心模块研发、阅读遥测状态机源码或提交 Pull Request，请阅读：

| 文档 | 内容摘要 | 适合场景 |
| :--- | :--- | :--- |
| [系统架构与内部原理](developer-guide/architecture.md) | 双通道毫秒级状态捕获、RPC 按需增量拉取、单进程双入口 Sidecar、防幽灵对账与 100% 只读安全边界 | 架构研读与模块实现 |
| [本地开发、测试与贡献指南](developer-guide/contributing.md) | TypeScript + `esbuild` 构建流水线、`<8ms` Hook 性能红线、`node:test` 单测与提交前强制门禁 | 本地开发、调试与提交贡献 |

---

## 相关链接

- **项目仓库**：[springtian1982/antigravity-pulse](https://github.com/springtian1982/antigravity-pulse)
- **姊妹插件**：[springtian1982/antigravity-pele](https://github.com/springtian1982/antigravity-pele)（Mermaid 12.1 & 33 种扩展图表渲染工作台）
- **配色体系**：[Flexoki by Steph Ango](https://stephango.com/flexoki)
- **开源协议**：[MIT License](../LICENSE) · [Third-Party Notices](../THIRD_PARTY_NOTICES.md)
