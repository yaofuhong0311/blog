---
title: AgentScope 源码调研（七）：锁之外还需要可验证的执行所有权
published: 2026-07-30
description: Session Lock 控制准入，但旧 Worker 恢复后仍可能写入；Owner Epoch 与 Store Fence 才能让各写入面拒绝过期执行者。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> Session Lock 能减少两个副本同时进入执行路径，却不能证明旧 Worker 恢复后无法继续写。生产级执行所有权还需要单调递增的 Owner Epoch，并由每个关键 Store 在写入时拒绝过期 Epoch。

![从 Session Lock 到可验证的执行所有权](/images/posts/agentscope-runtime-ownership.svg)

## 锁解决准入，不解决过期写入

AgentScope 使用共享 Session Lock 约束当前执行者，并在收尾阶段保存消息和状态。这构成清晰的单次执行模型，但租约过期与进程暂停可能形成以下情况：

```text
Worker A 获得锁后暂停
→ 租约到期
→ Worker B 获得锁并继续
→ Worker A 恢复并写入旧状态
```

只检查入口锁无法阻止最后一步。取消通知也不能作为唯一保护，因为暂停进程可能没有及时收到通知。

## Epoch 把所有权变成可比较事实

每次接管生成单调递增的 `owner_epoch`。Checkpoint、Memory、Approval 和 Workspace 元数据写入都携带该值，并与 Store 当前 Fence 比较：

```text
请求 epoch == Store 当前 epoch → 允许
请求 epoch < Store 当前 epoch  → 拒绝
```

Epoch 与随机 Token 的差别在于它表达先后关系。Store 不只知道“是不是同一个持有者”，还知道请求是否来自已经被替换的旧执行者。

保护范围必须覆盖真实写入链路。只对 Checkpoint 做 Fence，旧 Worker 仍可能修改长期 Memory、审批状态或共享 Workspace。

## 多 Store 需要明确激活边界

所有权同时存在于协调系统和多个 Store 时，获取锁后逐个初始化会留下中间状态。更明确的路径是：

```text
创建 reserved 所有权
→ 推进各 Store Fence
→ 全部接受新 epoch
→ 所有权变为 active
```

这不是分布式事务，但它规定了候选执行者什么时候才可以产生业务写入。推进失败时撤销 reservation，避免协调层已经切换、部分 Store 仍接受旧 Epoch。

等待用户确认也需要同样的消费权。稳定 Action ID、确认状态和 Owner Epoch 必须持久化；客户端连接断开或服务重启后，新 Worker 才能判断确认结果应交给哪次执行。

## 我的判断：所有权要沿写入面验证

我会把锁作为快速准入，把 Epoch 作为跨进程所有权版本，并在每个关键 Store 的写入入口做 Fence 校验。执行与客户端连接解耦，取消和 HITL 结果同样核验当前所有权。

代价是每个存储适配器都要支持 Fence，多 Store 接管也会增加延迟。若系统始终单副本且进程失败后不会并发恢复，Session Lock 已足够简单；一旦允许多副本接管或进程长时间暂停，入口锁就不能独立构成正确性证明。

<details>
<summary>源码起点与推导边界</summary>

- [`AgentScope Session Lock`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/message_bus/_base.py#L490-L501)
- [`ChatService` 持久化路径](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L674-L697)

源码能够证明 Session Lock 与持久化控制点存在。Owner Epoch、reserved/active 和跨 Store Fence 是本文基于更严格多副本故障模型提出的工程补充，不是对当前 AgentScope 已完整实现这些机制的声明。

</details>
