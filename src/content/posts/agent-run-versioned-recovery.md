---
title: Agent 工程（十五）：恢复旧 Run 前必须固定执行合同
published: 2026-08-28T10:00:00+08:00
description: Checkpoint 只记录执行位置；跨版本恢复还需要不可变的 AgentVersion、完整的 RunRecord、显式 Migration 与副作用 Reconcile。
tags: [AI Agent, AI Infra, Checkpoint, 版本管理]
category: Agent 工程
---

> Checkpoint 能说明任务暂停在哪里，却不能证明新版 Prompt、Tool Schema 和权限策略仍能安全延续旧任务。可恢复的 Agent 必须先固定执行合同，再记录本次运行事实。

![Agent Run 的版本化恢复链路](/images/posts/agent-run-versioned-recovery.svg)

## AgentVersion 固定执行合同

一次 Run 创建时，应绑定不可变的 `agent_version`。它描述本次执行依据的代码、Prompt、Model 参数、ToolSet、Memory Policy、权限策略和 Sandbox Image。

不可变不等于把全部内容复制到一张表，也可以引用不可变制品；关键是版本发布后不能原地修改。否则同一个 Checkpoint 在不同时间恢复，实际面对的工具参数、模型行为和安全边界可能已经改变。

用户输入、Message、ToolResult、Approval、实际 Sandbox ID 和短期凭证不属于 AgentVersion，它们是本次 Run 已经发生的动态事实。

## RunRecord 记录实际发生的事情

`RunRecord` 应回答“这次运行已经发生了什么”，至少包含 Run 状态、动作标识、Tool 调用、外部任务引用、审批结果和当前 Checkpoint。

Checkpoint 负责连接暂停前后的计算位置，但恢复时还要携带 `agent_version`、`state_schema_version` 和 `toolset_version`。HITL 确认是针对某个 `action_id` 的运行事实，应写入 RunRecord，而不是修改 AgentVersion。

这一区分使审计能够同时回答两个问题：

- 当时系统依据什么合同运行；
- 这次运行实际上执行了哪些动作。

## 跨版本恢复先迁移，再核对副作用

旧 Tool 下线后，不能直接把旧 ToolCall 交给新版 Schema。安全恢复需要两个独立步骤：

1. **Migration**：把旧状态转换为新 Schema，并重新执行权限与风险校验；
2. **Reconcile**：根据 idempotency key 或 external task ID 核对外部动作是否已经发生。

如果动作语义改变，应重新取得用户确认；如果无法判断旧动作是否已经产生副作用，应终止原 Run 或要求重新发起，不能静默升级后重跑。

恢复不是重新执行最后一步，而是先证明过去发生了什么，再从版本兼容且状态确定的位置继续。

## 我的选择：版本与 Run 生命周期一起管理

我会让新 Run 默认使用最新 AgentVersion，但让存量 Run 始终绑定创建时的版本。旧 Runtime 和 Tool 至少保留到存量 Run 结束；确实需要迁移时，由显式迁移任务生成新的状态，并保留旧版本、迁移版本和迁移原因。

这会增加制品保留、Schema 迁移和兼容测试成本。若任务没有持久化、没有 HITL，也不会产生外部副作用，Run 失败后整体重启更简单；一旦允许长时间暂停或跨发布恢复，版本合同就不能省略。

<details>
<summary>实现依据与延伸阅读</summary>

- [AgentScope](https://github.com/agentscope-ai/agentscope)
- [Harness 是逻辑架构，不是部署单元](/posts/agent-harness-logical-architecture/)
- [Checkpoint 链记录 Agent 的执行语义](/posts/agent-checkpoint-chain/)
- [Checkpoint 存储必须先定义恢复边界](/posts/agent-checkpoint-storage/)
- AgentVersion、RunRecord 与 Migration 是本文给出的服务端工程设计，不表示 AgentScope 当前已经完整实现这些对象。

</details>
