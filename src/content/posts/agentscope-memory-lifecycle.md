---
title: AgentScope 源码调研（十）：Memory 不等于历史消息
published: 2026-07-30
description: AgentState 保持当前执行连续，Long-term Memory Middleware 跨会话检索与写回；两者生命周期和治理要求不同。
tags: [AgentScope, AI Agent, Memory, 源码分析]
category: 源码调研
---

> AgentScope 的 `AgentState` 保存当前执行上下文，Long-term Memory Middleware 则在一轮 Reply 前检索、结束后写回跨会话信息。两者都可能向模型提供内容，但恢复对象、生命周期和治理要求不同。

![Message、AgentState、Long-term Memory 与 RAG 的边界](/images/posts/agentscope-memory-boundaries.svg)

## AgentState 服务于当前执行

`AgentState` 包含 Session、上下文、摘要、Reply 位置、权限、工具和任务状态。它回答的是：

- 当前 ToolCall 是否在等待结果；
- 本轮 Reply 执行到哪一步；
- 当前权限与任务上下文是什么；
- 压缩前后需要继续提供哪些消息。

这些信息用于 Checkpoint 和故障恢复。把临时 Tool 结果写入长期记忆，既不能替代 AgentState，也可能让一次失败执行污染后续会话。

## Middleware 管理长期记忆生命周期

Long-term Memory Middleware 在 Agent Loop 外围介入：

```text
收到新输入
→ 提取检索查询
→ Reply 开始前检索长期记忆
→ 注入当前上下文
→ Agent 正常执行
→ 捕获最终 AssistantMsg
→ Reply 结束后写回
```

`static_control`、`agent_control` 和 `both` 改变由 Middleware 还是模型决定读写，但不会消除长期记忆的治理问题。

这一顺序说明长期记忆是按需提供的外部知识，不是完整历史消息的另一份副本。

## 自动写回不等于记忆治理

生产记忆层还需要回答：

- 哪些信息值得跨会话保存；
- 事实来自哪个用户、任务和时间；
- 新旧事实冲突时如何更正；
- 用户要求删除时如何追踪派生内容；
- 召回多少内容才不会挤占当前上下文；
- 不可信输入是否会被提升为长期规则。

仅把最终消息交给记忆服务，可能保存未经确认的模型推断。来源、作用域、置信度和更正关系应当与记忆内容一起持久化。

## 我的判断：候选先隔离，确认后提升

我会先把自动提取结果保存为候选，只从用户确认、工具真实结果或可验证产出中提升长期事实。每条记忆记录来源与作用域，整轮只检索一次并复用，更正与删除作为首要接口。

代价是写入链路更复杂，记忆增长也会更慢。若产品不需要跨会话个性化或长期学习，AgentState 与普通历史已经足够；只有明确存在长期复用价值时，才应启用自动记忆，并持续监控错误召回和污染。

<details>
<summary>关键源码路径</summary>

- [`AgentState`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/state/_state.py)
- [`Agent` Middleware 装配](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/agent/_agent.py)
- [`Mem0Middleware`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/middleware/_longterm_memory/_mem0/_middleware.py)

</details>
