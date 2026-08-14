# Agent Sandbox 状态收敛文章 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布“Agent Sandbox 工程实践”专题第一篇，解释控制面为什么需要状态收敛，以及 Sandbox 消失后的恢复决策。

**Architecture:** 文章以一次运行环境丢失为入口，依次区分三类状态、解释 Reconcile 循环、分析恢复语义，并以当前工程可确认的能力边界收束。两张 SVG 分别承载状态收敛和恢复决策，正文通过站内链接复用既有沙箱机制文章。

**Tech Stack:** Astro content collections、Markdown、静态 SVG、Biome、Astro Check。

## Global Constraints

- 使用正式、准确的技术表达，不使用俗语。
- 区分通用机制、当前工程事实和基于现有证据无法确认的部分。
- 不公开内部服务名、私有仓库路径、提交哈希、部署参数或组织信息。
- 不重复展开“沙箱底层机制”中已经发布的基础原理。
- 本次只创建第一篇文章及专题入口，不修改首页和页面组件。
- 未经用户明确要求，不执行 Git commit 或 push。

---

### Task 1: 建立专题入口

**Files:**
- Modify: `src/constants/series.ts`

**Interfaces:**
- Consumes: 现有 `SeriesDef` 与 `seriesList`。
- Produces: slug 为 `agent-sandbox-engineering` 的系列定义，第一篇 slug 为 `agent-sandbox-reconcile`。

- [ ] **Step 1: 新增系列定义**

在 `seriesList` 末尾追加：

```ts
{
  slug: "agent-sandbox-engineering",
  title: "Agent Sandbox 工程实践",
  description:
    "从状态收敛、动作恢复、隔离选型与冷启动优化出发，分析 Agent Sandbox 控制面如何把底层机制组织成可恢复、可运营的平台能力。",
  posts: ["agent-sandbox-reconcile"],
},
```

- [ ] **Step 2: 验证 TypeScript 格式**

Run: `pnpm exec biome check src/constants/series.ts`

Expected: `No fixes applied`，退出码为 0。

### Task 2: 绘制状态收敛图

**Files:**
- Create: `public/images/posts/agent-sandbox-reconcile-loop.svg`

**Interfaces:**
- Consumes: 文章中的期望状态、观测状态和业务状态定义。
- Produces: 1200×720 的无脚本 SVG，供正文第一部分引用。

- [ ] **Step 1: 创建状态收敛图**

图中必须包含：

```text
任务依据（期望状态）
→ 查询 Sandbox（观测状态）
→ 比较差异
→ 分类动作：继续等待 / 更新记录 / 进入恢复决策
→ 下一轮 Reconcile
```

图下注明：Reconcile 负责识别和分类差异，不负责证明业务动作可以安全重做。

- [ ] **Step 2: 验证 SVG**

Run:

```bash
rg -n '<title|<desc|viewBox="0 0 1200 720"' public/images/posts/agent-sandbox-reconcile-loop.svg
```

Expected: 三项均存在，并包含中文无障碍描述。

### Task 3: 绘制恢复决策图

**Files:**
- Create: `public/images/posts/agent-sandbox-recovery-decision.svg`

**Interfaces:**
- Consumes: 任务能否安全重做、上次动作结果是否可确认等判断。
- Produces: 1200×760 的恢复决策 SVG，供正文恢复章节引用。

- [ ] **Step 1: 创建恢复决策图**

决策路径必须表达：

```text
Sandbox 是否仍存在
├─ 是：继续查询或执行
└─ 否：上次动作结果是否可确认
   ├─ 已成功：从下一个明确步骤继续
   ├─ 已失败：按策略重试或终止
   └─ 无法确认：动作是否具备强幂等
      ├─ 是：从步骤起点重新执行
      └─ 否：标记失败或等待人工确认
```

- [ ] **Step 2: 验证 SVG**

Run:

```bash
rg -n '<title|<desc|viewBox="0 0 1200 760"' public/images/posts/agent-sandbox-recovery-decision.svg
```

Expected: 三项均存在，所有分支文本完整。

### Task 4: 编写专题第一篇

**Files:**
- Create: `src/content/posts/agent-sandbox-reconcile.md`

**Interfaces:**
- Consumes: 两张 SVG、现有文章 `/posts/sandbox-declarative-k8s/` 与 `/posts/agentscope-runtime-ownership/`。
- Produces: 可由 Astro content collection 构建的 Markdown 文章。

- [ ] **Step 1: 写入 frontmatter**

使用：

```yaml
title: Agent Sandbox 工程实践（一）：为什么控制面需要状态收敛
published: 2026-08-14
description: 从期望状态、观测状态与业务状态的差异出发，分析 Sandbox 消失后为什么不能直接重建，以及控制面如何做出可恢复、失败或待确认的决策。
tags: [Agent Sandbox, AI Infra, Kubernetes, Reconcile, 故障恢复]
category: 学习笔记
```

- [ ] **Step 2: 完成正文结构**

正文依次包含：

```text
一、问题不是 Pod 能否重新创建
二、三种状态不能混为一谈
三、Reconcile 负责持续对账
四、Sandbox 消失不等于任务可以重做
五、恢复决策必须建立在业务语义上
六、当前工程能够确认的能力边界
七、设计检查清单
八、结论
```

文章长度控制在 3000 至 4500 个中文字符。避免使用“无脑”“拍脑袋”“打穿”“套路”等非正式措辞。

- [ ] **Step 3: 做公开内容扫描**

Run:

```bash
rg -n 'Harbor|Polar|cennavi|frontis|commit|内部|私有仓库|无脑|拍脑袋|打穿|套路' src/content/posts/agent-sandbox-reconcile.md
```

Expected: 无内部标识和非正式措辞命中；必要的“内部状态”术语不在禁用范围内。

### Task 5: 完整验证与本地预览

**Files:**
- Verify: `src/constants/series.ts`
- Verify: `src/content/posts/agent-sandbox-reconcile.md`
- Verify: `public/images/posts/agent-sandbox-reconcile-loop.svg`
- Verify: `public/images/posts/agent-sandbox-recovery-decision.svg`

**Interfaces:**
- Consumes: Tasks 1–4 的全部产物。
- Produces: 可构建、可预览且没有内部信息的第一篇文章。

- [ ] **Step 1: 运行质量门禁**

Run:

```bash
pnpm astro check &&
pnpm exec biome ci ./src &&
pnpm build &&
git diff --check
```

Expected: Astro 0 errors、Biome 无修复、生产构建成功、diff 检查无输出。

- [ ] **Step 2: 启动本地预览**

Run:

```bash
pnpm exec astro dev --host 127.0.0.1 --force
```

Expected: `http://127.0.0.1:4321/posts/agent-sandbox-reconcile/` 返回 200。

- [ ] **Step 3: 检查视觉结果**

确认：

- 标题和 frontmatter 信息不拥挤。
- 两张 SVG 均完整加载，文字没有裁切。
- H2 层级清楚，表格和清单没有横向溢出。
- 系列页出现“Agent Sandbox 工程实践”及第一篇入口。
