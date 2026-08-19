# Blog Editorial Samples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将五类代表文章改造成摘要优先、证据按需展开的阅读样板。

**Architecture:** 不改变 Astro 页面与内容模型，只重构 Markdown 的信息层级。可见正文负责问题、结论和工程选择；源码与边界细节由表格、站内链接和原生 `<details>` 承接。

**Tech Stack:** Astro Content Collections、Markdown、原生 HTML details/summary、Biome、Astro check

**Spec:** `docs/superpowers/specs/2026-08-19-blog-editorial-system-design.md`

## Global Constraints

- 每篇文章只表达一个中心判断。
- 开头 220 个正文字符内出现问题、结论和阅读收益。
- 普通可见正文目标为 1500～2200 个中文字符。
- 主体二级章节不超过 4 个。
- 不删除事实来源、适用边界和个人工程判断。
- 不新增依赖、分类或页面。
- 未经用户明确要求不创建 Git commit 或 push。

---

### Task 1: Agent 工程样板

**Files:**
- Modify: `src/content/posts/agent-loop-harness.md`

**Interfaces:**
- Consumes: 现有 Agent 工程系列链接与 `agent-loop-boundary.svg`
- Produces: 其他机制文章可复用的“一个判断 + 三个推论”结构

- [x] 将开头改为问题、结论和阅读收益。
- [x] 将七个机制章节压缩为三个主体章节。
- [x] 保留 Message 重发、ToolCall 配对和 Harness 边界三个必要事实。
- [x] 运行结构指标脚本，确认章节与长度符合设计。

### Task 2: 沙箱系统样板

**Files:**
- Modify: `src/content/posts/sandbox-deep-dive.md`

**Interfaces:**
- Consumes: `sandbox-isolation-ladder.svg` 与沙箱系列后续文章链接
- Produces: 机制总览文章的“选型表 + 主判断 + 深入入口”结构

- [x] 开头直接回答如何选择 Agent Sandbox。
- [x] 将七个角度压缩为一张比较表。
- [x] 保留隔离阶梯和 Facade 工程判断。
- [x] 将详细机制导向现有系列文章。

### Task 3: 源码调研样板

**Files:**
- Modify: `src/content/posts/agent-serverside-anatomy.md`

**Interfaces:**
- Consumes: 现有固定提交源码链接
- Produces: 可见结论层和 `<details>` 源码证据层

- [x] 开头给出服务端 Session 的核心结论。
- [x] 可见正文只保留无状态副本、事件唤醒和恢复边界。
- [x] 将调用链、代码标识符和缺口枚举移入“实现依据”。
- [x] 构建后检查 details/summary 可展开且 Markdown 正常渲染。

### Task 4: 工程实践样板

**Files:**
- Modify: `src/content/posts/agent-sandbox-reconcile.md`

**Interfaces:**
- Consumes: `agent-sandbox-reconcile-loop.svg` 与 `agent-sandbox-recovery-decision.svg`
- Produces: 以故障决策为中心的工程实践结构

- [x] 用“Sandbox 消失后能否直接重建”作为唯一问题。
- [x] 用期望、观测和业务状态解释判断依据。
- [x] 保留最小控制面选择和不自动恢复的边界。
- [x] 删除重复检查清单与重复结论。

### Task 5: AI Coding 样板

**Files:**
- Modify: `src/content/posts/ai-coding-workflow-2026.md`

**Interfaces:**
- Consumes: `ai-coding-workflow.svg`、`staged-verify.svg`
- Produces: 经验文章的“问题 → 分层方法 → 实际效果”结构

- [x] 将中心判断改为“行为约束不能替代结果验证”。
- [x] 合并三层防御与四阶段验证中的重复说明。
- [x] 只保留最能说明半年实践变化的例子。
- [x] 将 skill 清单压缩为按需加载的原则。

### Task 6: 全量验证

**Files:**
- Verify: 上述五篇文章及其引用资源

**Interfaces:**
- Consumes: 五篇样板
- Produces: 用户可比较的本地预览

- [x] 运行五篇结构指标和禁用措辞检查。
- [x] 运行 `pnpm exec biome check ./src`。
- [x] 运行 `pnpm check`。
- [x] 运行 `pnpm build`。
- [x] 在桌面端逐篇检查标题、首屏、图片、表格和 details。
- [x] 在 390px 视口抽查页面级横向溢出。
