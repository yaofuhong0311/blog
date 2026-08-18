# AgentScope Memory 文章 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布“AgentScope 源码调研”第十篇，解释 Message、AgentState、Long-term Memory 与 RAG 的边界及 Memory Middleware 的真实生命周期。

**Architecture:** 文章固定在 AgentScope commit `698297b`，从 `AgentState` 与 `Mem0Middleware.on_reply()` 的源码出发，区分框架事实和记忆治理建议。两张 SVG 分别承载状态边界和读写生命周期。

**Tech Stack:** Astro content collections、Markdown、静态 SVG、Biome、Astro Check。

**Spec:** `docs/SDD.md`

## Global Constraints

- 使用正式、准确的中文技术表达，不使用俗语。
- 发布日期固定为 `2026-08-18`。
- 源码事实必须链接到 AgentScope 官方固定提交。
- 不把框架提供的 Middleware 能力写成业务系统已经完成的治理策略。
- 每张 SVG 保持单一叙事重点，避免文字密集。

---

### Task 1: 编写源码文章与边界图

**Files:**
- Create: `src/content/posts/agentscope-memory-lifecycle.md`
- Create: `public/images/posts/agentscope-memory-boundaries.svg`

**Interfaces:**
- Consumes: AgentScope `AgentState`、`Mem0Middleware` 与飞书文档 revision 91 第十九章。
- Produces: 系列第十篇正文和四类状态边界图。

- [ ] **Step 1: 完成文章**

文章必须覆盖：

```text
Message / AgentState / Long-term Memory / RAG
static_control / agent_control / both
on_reply 前置检索、ReplyStartEvent 注入、结束后写回
命名空间、写入时机、Token 成本与记忆治理
```

- [ ] **Step 2: 创建边界图**

图中按恢复对象、生命周期和进入 Context 的方式区分四类信息。

### Task 2: 绘制生命周期图并注册系列

**Files:**
- Create: `public/images/posts/agentscope-memory-lifecycle.svg`
- Modify: `src/constants/series.ts`

**Interfaces:**
- Consumes: `Mem0Middleware.on_reply()` 的执行顺序。
- Produces: Memory 读写生命周期图与系列第十篇入口。

- [ ] **Step 1: 创建生命周期图**

图中表达：

```text
新请求 → 检索 → ReplyStartEvent 后注入 → ReAct → 最终回复 → 写回
```

并说明没有最终 AssistantMsg 时不执行该次自动写回。

- [ ] **Step 2: 将文章 slug 追加到系列**

在 `agentscope` 的 `posts` 中追加 `agentscope-memory-lifecycle`。

### Task 3: 验证

**Files:**
- Verify: 本计划涉及的全部文件。

**Interfaces:**
- Consumes: Tasks 1–2 的产物。
- Produces: 可构建、链接可解析且表述边界准确的文章。

- [ ] **Step 1: 运行内容与链接检查**

Run:

```bash
rg -n '无脑|拍脑袋|打穿|套路|frontis\.cn|cennavi|Harbor' src/content/posts/agentscope-memory-lifecycle.md
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
