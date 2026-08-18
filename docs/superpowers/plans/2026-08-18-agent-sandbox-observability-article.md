# Agent Sandbox 可观测性文章 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布“Agent Sandbox 工程实践”第三篇，解释 Leader Election、阶段指标与 SLI/SLO 如何共同形成可运营的创建控制面。

**Architecture:** 文章以当前整体创建耗时指标为源码事实，使用两张 SVG 分别说明阶段耗时和控制面可靠性闭环。正文明确区分现状、通用机制和工程建议，不把尚未实现的阶段指标或 Autoscaler 写成当前能力。

**Tech Stack:** Astro content collections、Markdown、静态 SVG、Biome、Astro Check。

**Spec:** `docs/SDD.md`

## Global Constraints

- 使用正式、准确的中文技术表达，不使用俗语。
- 发布日期固定为 `2026-08-18`，不使用未来日期。
- 不公开私有仓库地址、内部域名、集群参数或组织信息。
- 当前实现、通用机制和工程建议必须显式分开。
- 每张 SVG 保持单一叙事重点，避免文字密集。

---

### Task 1: 编写文章与阶段耗时图

**Files:**
- Create: `src/content/posts/agent-sandbox-observability-slo.md`
- Create: `public/images/posts/agent-sandbox-stage-metrics.svg`

**Interfaces:**
- Consumes: 当前 `frontis.sandbox.launch.duration` 整体指标、飞书文档 revision 72 的 14.29–14.31 节。
- Produces: 系列第三篇正文和创建阶段耗时图。

- [ ] **Step 1: 写入 frontmatter 与正文**

正文包含 Leader Election 的能力边界、状态与阶段指标的区别、Metric/SLI/SLO 定义、失败分类和工程建议。

- [ ] **Step 2: 创建阶段耗时图**

图中表达：

```text
入队 → Worker 领取 → CR 创建 → Pod 调度 → 容器启动 → execd 健康
```

并标出各阶段常见瓶颈，不虚构具体耗时数值。

### Task 2: 绘制可靠性闭环并注册系列

**Files:**
- Create: `public/images/posts/agent-sandbox-reliability-loop.svg`
- Modify: `src/constants/series.ts`

**Interfaces:**
- Consumes: Reconcile、幂等、Leader Election、阶段指标和 SLO 的职责。
- Produces: 可靠性闭环图与系列第三篇入口。

- [ ] **Step 1: 创建可靠性闭环图**

图中表达：

```text
Leader Election → 执行权
Reconcile + 幂等 → 状态正确性
阶段指标 → 定位瓶颈
SLI/SLO → 判断用户体验是否达标
```

- [ ] **Step 2: 将文章 slug 追加到系列**

在 `agent-sandbox-engineering` 的 `posts` 中追加 `agent-sandbox-observability-slo`。

### Task 3: 验证

**Files:**
- Verify: 本计划涉及的全部文件。

**Interfaces:**
- Consumes: Tasks 1–2 的产物。
- Produces: 可构建、可访问且无公开信息泄漏的文章。

- [ ] **Step 1: 运行内容检查**

Run:

```bash
rg -n '无脑|拍脑袋|打穿|套路|frontis\.cn|cennavi|Harbor' src/content/posts/agent-sandbox-observability-slo.md
```

Expected: 无命中。

- [ ] **Step 2: 运行完整质量门**

Run:

```bash
pnpm astro check &&
pnpm exec biome ci ./src &&
pnpm build &&
git diff --check
```

Expected: 全部退出码为 0。
