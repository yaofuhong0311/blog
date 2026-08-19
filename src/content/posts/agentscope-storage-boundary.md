---
title: AgentScope 源码调研（六）：Session 与 Message 为什么分开存储
published: 2026-07-30
description: Session 是当前状态快照，Message 是按会话增长的有序集合；StorageBase 统一业务语义，但不抹平数据模型差异。
tags: [AgentScope, AI Agent, Storage, 源码分析]
category: 源码调研
---

> Session 与 Message 都包含 `session_id`，却不应因此保存在同一结构中。AgentScope 的存储抽象说明，边界应由数量关系、生命周期、更新方式和查询模式决定，而不是由关联字段决定。

## StorageBase 固定业务操作

`ChatService` 不直接处理 SQL 表或 Redis Key，而是调用：

```python
await storage.upsert_message(user_id, session_id, reply_msg)
await storage.update_session_state(
    user_id=user_id,
    agent_id=agent_id,
    session_id=session_id,
    state=agent.state,
)
```

`StorageBase` 因此更接近业务持久化端口。Redis 与 SQL 适配器负责序列化、主键、TTL 和事务提交，上层只依赖“保存消息快照”和“更新 Session 状态”的语义。

## Session 与 Message 具有不同数据形状

| 角度 | Session | Message |
| --- | --- | --- |
| 数量 | 每个会话一条当前记录 | 每个会话持续产生多条 |
| 生命周期 | 创建、更新、终止 | 随每轮对话追加 |
| 更新 | 替换当前 AgentState | 新消息插入，同一回复可更新 |
| 查询 | 按 Session ID 读取 | 分页、排序或按消息 ID 定位 |

SQL 实现因此使用 Session 当前记录和 `(session_id, msg_id)` 复合主键的 Message 表。消息 ID 稳定，使同一轮恢复后的 `upsert_message()` 更新原回复，而不是产生重复消息。

## 相同接口不代表相同一致性

Redis 与 SQL 都实现 `upsert_message`，但底层原子性、排序和过期行为并不完全相同。`ChatService` 收尾时依次保存 Message、更新 Session State，再 Trim Event Log；异步屏蔽可以保证取消期间继续执行收尾，却不能把多个操作变成跨对象事务。

可能出现的中间状态包括：

- Message 已保存，Session State 尚未更新；
- Session State 已更新，Event 尚未清理；
- Redis 列表与 SQL 排序对同一边界条件处理不同。

所以统一接口固定的是业务意图，不是自动获得统一事务语义。恢复路径仍需规定哪一项是权威事实，并对重复写入保持幂等。

## 我的判断：统一端口，显式声明一致性

我会保留 Session 与 Message 的独立模型，通过统一存储端口约束上层调用，同时为每个实现写出顺序、幂等、事务和过期保证。

代价是业务层不能假设所有后端完全等价，测试也必须覆盖多个适配器。若部署只使用一种数据库，仍然值得保留领域端口；只有在业务语义本身完全相同的情况下才共享接口，不能为了“可替换”隐藏实际一致性差异。

<details>
<summary>关键源码路径</summary>

- [`StorageBase` 的 Message 操作](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_base.py#L401-L454)
- [`SessionRow` 与 `MessageRow`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_sql/_tables.py#L132-L163)
- [`ChatService` 持久化顺序](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L674-L697)

</details>
