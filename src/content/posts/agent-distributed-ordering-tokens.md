---
title: Agent 工程（十六）：多副本执行需要四种秩序标识
published: 2026-08-28T11:00:00+08:00
description: 消息重复、状态乱序、旧 Owner 回写与稀缺资源重复分配是四类故障，必须分别使用 event_id、status_version、owner_epoch 和 Resource Token。
tags: [AI Agent, AI Infra, 分布式系统, GPU]
category: Agent 工程
---

> 多副本 Agent 不能依赖“消息只到一次、状态严格有序、旧 Worker 不会恢复、GPU 已经自动释放”这些假设。四类故障需要四种不同标识，不能由一把分布式锁统一解决。

![多副本 Agent 的四种秩序标识](/images/posts/agent-distributed-ordering-tokens.svg)

## 四种标识回答四个问题

| 标识 | 回答的问题 | 典型处理 |
| --- | --- | --- |
| `event_id` | 是否为同一条消息 | Inbox 幂等去重 |
| `status_version` | 状态是新是旧 | 单调版本与状态机拒绝回退 |
| `owner_epoch` | Worker 是否仍有写入权 | Store Fence 拒绝旧 Owner |
| Resource Token | 稀缺资源是否已被占用 | 原子分配、Lease 与物理回收 |

时间戳不能代替这些标识。服务时钟、网络延迟和重试顺序都不可靠；同一个事件也可能因为 ACK 丢失再次投递，而不要求系统已经部署多个副本。

并发修改同一状态时，还需要 CAS 或数据库事务保证只有一个合法迁移成功。

## DB 保存事实，Message Bus 负责及时通知

数据库回答“当前真实状态是什么”，Message Bus 回答“状态变化后应及时通知谁”。事件可以降低恢复延迟，但不能成为唯一事实来源；低频 Reconcile 仍要修复丢失、延迟或处理失败的通知。

消息也不都适合广播执行：

- 停止请求可以广播，由实际持有本地任务的副本处理；
- Session Event 发往对应 Channel；
- Tool 完成、HITL 结果和定时任务应进入可领取的 Queue，由一个消费者执行。

业务状态更新与消息发布跨越两个系统时，Transactional Outbox 可以让状态与待发布记录在同一数据库事务中提交，消费端再以稳定 `event_id` 幂等处理。

## Resource Token 还要连接物理清理

Session Lock 保护同一会话的执行权，却不能防止不同 Session 竞争同一块 GPU。稀缺资源需要单独的 Resource Token，至少记录 `resource_id`、Owner、Lease 到期时间和 `owner_epoch`。

Lease 过期只表示旧 Owner 失去逻辑占用，不代表它启动的 GPU 进程已经停止。重新分配前必须 Reconcile Worker、容器和 GPU 进程的真实状态，完成终止或隔离后才能向新 Owner 发放更大的 Epoch。

Fencing 可以拒绝旧 Owner 的续租和结果写入，但不能自动终止已经运行的物理进程。逻辑围栏与资源清理必须同时存在。

## 我的选择：每层只承担一种秩序

我会让事件、状态、执行所有权和资源分配分别维护自己的稳定标识，并把它们集中写入 RunRecord 和审计事件。Kubernetes GPU 任务交给 Scheduler 与 Device Plugin 做资源记账；外部 GPU Worker Pool 则显式维护 `task_id → Worker → GPU UUID → Lease → Epoch` 映射。

代价是事件信封和状态记录更复杂，恢复路径也必须跨 DB、Message Bus 与 Resource Manager 核对。单进程、无外部副作用且没有稀缺设备时，可以只保留 `event_id` 和状态版本；进入多副本接管或 GPU 调度后，其余边界不能再依赖进程内假设。

<details>
<summary>实现依据与延伸阅读</summary>

- [AgentScope：多实例 Wake-up 重复执行问题](https://github.com/agentscope-ai/agentscope/issues/1868)
- [AgentScope：Resume 事件重复或丢失问题](https://github.com/agentscope-ai/agentscope/issues/2227)
- [Kubernetes Leases](https://kubernetes.io/docs/concepts/architecture/leases/)
- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
- [锁之外还需要可验证的执行所有权](/posts/agentscope-runtime-ownership/)

</details>
