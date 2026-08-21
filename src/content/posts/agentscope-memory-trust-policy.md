---
title: AgentScope 源码调研（十一）：Memory 不能由模型直接判定生效
published: 2026-08-21T10:00:00+08:00
description: 模型可以从对话中提取记忆候选，但来源、可信度、作用域和有效期必须由确定性 Policy 裁决。
tags: [AgentScope, AI Agent, Memory, Mem0]
category: 源码调研
---

> Long-term Memory 不是对话事实的权威副本，而是从历史中提炼出的派生状态。模型适合识别候选信息，不适合独立决定什么长期生效；最终裁决需要可审计的证据与确定性 Policy。

![从对话到生效 Memory 的治理链路](/images/posts/agentscope-memory-trust-policy.svg)

## Memory 是派生状态，不是事实来源

Message 保存实际对话，AgentState 与 Checkpoint 保存执行进度，RAG 提供外部知识；Long-term Memory 只保存跨 Session 值得复用的信息。

Memory 经过提取和压缩，天然存在信息损失。复制全部 Message 还会把临时要求、未确认推测和过期信息带入未来会话。

前一篇[《Memory 不等于历史消息》](/posts/agentscope-memory-lifecycle/)讨论生命周期差异；这里继续回答候选由谁判定生效。

## 模型负责提名，Policy 负责裁决

Extractor 可以利用模型拆分语义并输出结构化候选，但候选不应直接进入生效区。

我会把证据等级区分为：

| 等级 | 典型来源 | 可承担的结论 |
| --- | --- | --- |
| `VERIFIED` | 权威业务系统或可验证结果 | 对应业务范围内的事实 |
| `DECLARED` | 用户明确表达 | 用户偏好、计划或授权范围 |
| `OBSERVED` | 跨时间重复行为 | 可供后续确认的模式 |
| `INFERRED` | 模型根据单次行为推断 | 只作为短期候选 |
| `CONFLICTED` | 新旧证据不一致 | 停止自动注入，等待消解 |

确定性 Policy 检查主体、作用域、敏感性、证据和冲突，决定 `ACTIVE`、`CANDIDATE` 或 `REJECT`。模型可以理解时间表达，但有效期应由代码计算。

## 异步写入只能服务后续轮次

Run 开始前的 Memory 检索影响本轮 Context，通常需要同步完成；Run 结束后的提取主要服务下一轮，可以异步执行。

以 Mem0 Platform 为例，新增记忆可能先返回 `PENDING`，处理完成后才可检索。因此当前 Session 仍应以 Message 和 AgentState 为事实来源。

权限、HITL 决策和外部任务终态应先进入权威业务存储，不能只依赖最终一致的 Memory。

## 我的选择：候选隔离、证据追踪、按作用域召回

每条候选至少记录主体、作用域、证据、可信度、`valid_to` 和状态。停止参与推理与物理删除应分开管理。

同一任务内重复表达不等于长期偏好；跨时间重复也不能绕过敏感性和权限检查。持久化不代表每轮都应注入。

这套治理增加了候选区和版本历史。若产品不需要跨会话个性化，Message 与 AgentState 已经足够。

<details>
<summary>实现依据与延伸阅读</summary>

- [AgentScope `Mem0Middleware`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/middleware/_longterm_memory/_mem0/_middleware.py)
- [Mem0：How Mem0 Adds Memory](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-operations/add.mdx)
- [Mem0 Custom Instructions](https://docs.mem0.ai/open-source/features/custom-instructions)
- [Agent 工程：四类“记忆”为什么不能混在一起](/posts/agent-memory-layers/)

</details>
