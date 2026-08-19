---
title: AgentScope 源码调研（四）：锁只决定谁能执行
published: 2026-07-29
description: Session Lock 回收执行资格，Checkpoint 保存停留位置，Tool 状态说明外部动作进度；三者共同决定恢复路径。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> 分布式锁只能回答“现在谁有资格执行 Session”，不能回答“上一个 Tool 是否已经生效”。AgentScope 的恢复路径需要同时读取实时租约、持久化 Checkpoint 和 Tool 状态，三类事实不能互相替代。

## 租约管理执行资格

多个服务副本会针对同一个 Session Key 竞争共享锁。成功者执行，其他副本拒绝重复运行；Worker 崩溃后不再续租，TTL 到期使执行资格可以重新获得。

锁过期只说明原 Worker 不再被认为有效。它不说明外部请求是否到达，也不说明 Tool 是否已经创建任务。把“租约失效”直接解释为“操作失败并可重试”，可能造成副作用重复。

Pub/Sub 同样只负责通知某个 Session 需要检查，不负责选主，也不应成为状态来源。消费者收到消息后仍需竞争锁并重新读取持久化事实。

## Session 状态来自实时与持久化两层

AgentScope 查询 Session 状态时先检查实时 Run Lock：存在有效执行者即为 `RUNNING`。没有执行者时，再从 Checkpoint 上下文推导是否等待确认、等待外部结果或已经空闲。

```text
实时租约：当前有没有 Worker 执行
持久化上下文：没有 Worker 时停在什么位置
```

这两层描述不同维度。Checkpoint 可能稍旧，但租约仍表明任务正在运行；租约消失后，持久化状态才决定下一步是继续、等待还是对账。

## Tool 状态决定恢复动作

Worker 崩溃后，调用栈和局部变量全部消失。新 Worker 只能依据最后一个可靠 Checkpoint 与 Tool 状态恢复：

| Checkpoint 尾部 | 恢复动作 |
| --- | --- |
| 无待处理 Tool | 从保存位置继续 |
| 等待用户确认 | 保持等待并关联原 Action |
| 已提交外部执行 | 查询或等待外部结果 |
| 结果不明确 | 进入恢复层 `UNKNOWN`，先对账 |

`UNKNOWN` 不是 Tool 的正常执行状态，而是恢复层承认当前证据不足。此时最危险的动作是直接重发；更可靠的方式是通过外部任务 ID 查询真实状态，无法确认时交由人工处理。

Tool 状态也不等于幂等性。即使记录了“已提交”，下游仍需通过任务 ID 或幂等键识别重复请求。

## 我的判断：恢复是一次事实重建

恢复流程应当是：

```text
租约到期
→ 新 Worker 获得执行权
→ 读取 Checkpoint
→ 检查待处理 Tool 与外部任务
→ 继续、等待、对账或人工介入
```

我不会从锁状态直接推断 Tool 结果，也不会让通知消息携带唯一状态。代价是需要持久化稳定 Action ID、外部任务 ID 和恢复决策；但只有这些进程外事实，才能避免进程重启后重复副作用。

<details>
<summary>关键源码路径</summary>

- [`MessageBus` 锁接口与 Session Run 租约](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/message_bus/_base.py#L320-L365)
- [`Session` 状态判断](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_session.py#L139-L202)
- [`Tool` 状态块](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/message/_block.py#L128-L214)

</details>
