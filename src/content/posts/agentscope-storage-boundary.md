---
title: AgentScope 源码调研（六）：Storage 抽象如何拆分 Session 与 Message
published: 2026-08-07
description: 从 StorageBase、RedisStorage 与 SQLStorage 的实现出发，分析 AgentScope 如何划分会话状态和消息数据，并将流式回复的内存快照转化为可恢复的持久化记录。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> **结论先行：** 从 StorageBase、RedisStorage 与 SQLStorage 的实现出发，分析 AgentScope 如何划分会话状态和消息数据，并将流式回复的内存快照转化为可恢复的持久化记录。

![AgentScope Storage 的职责边界](/images/posts/agentscope-storage-boundary.svg)

## 快速阅读

### 一、StorageBase 是业务层的持久化端口

ChatService 不直接构造 SQL，也不感知 Redis List。它只调用 StorageBase 定义的业务操作：

### 四、同一个 upsert，在 Redis 与 SQL 中并不完全相同

Redis 使用 List 保存一个 Session 的消息。执行 upsertmessage() 时，它只检查 List 尾部：

### 七、从这段实现可以提取的设计判断

Agent 系统设计存储层时，可以先按以下顺序判断：

<details>
<summary>展开完整分析与实现依据</summary>

> 本文是「AgentScope 源码调研」系列第 6 篇，接着[上一篇](/posts/agentscope-event-reducer/)分析归并完成的 `AssistantMsg` 如何进入持久化层。源码固定在 AgentScope 主分支提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。

上一篇讨论了 Event 如何持续修改同一条 `AssistantMsg`。但内存中形成完整消息，并不意味着它已经可以跨进程恢复。服务端还需要回答三个问题：

1. 上层业务应该依赖 Redis、SQL，还是一个稳定的存储接口？
2. Session 状态与 Message 是否应该保存为同一种记录？
3. 流式回复中持续变化的消息，应该在什么时机写入存储？

AgentScope 的实现路径可以概括为：

```text
ChatService
    ↓
StorageBase
    ├── RedisStorage
    └── AsyncSQLAlchemyStorage
```

其中，`StorageBase` 向业务层提供会话、消息、用户与 Agent 配置等操作；Redis 和 SQL 实现负责把这些操作映射到各自的数据结构。这个边界将“业务要保存什么”与“存储系统如何保存”分开。

## 一、StorageBase 是业务层的持久化端口

`ChatService` 不直接构造 SQL，也不感知 Redis List。它只调用 `StorageBase` 定义的业务操作：

```python
await storage.upsert_message(user_id, session_id, reply_msg)
await storage.update_session_state(
    user_id=user_id,
    agent_id=agent_id,
    session_id=session_id,
    state=agent.state,
)
```

从分层职责看，`StorageBase` 更接近业务层使用的 Repository 接口或持久化端口：方法以 Session、Message、AgentState 等领域对象为参数，而不是暴露表名、Redis key 或数据库方言。

`RedisStorage` 与 `AsyncSQLAlchemyStorage` 则是具体适配器。它们需要处理序列化、主键、TTL、List 操作、SQL 方言和事务提交，但这些差异不会进入 `ChatService`。

因此，这里不宜简单概括为“统一了两种数据库 API”。更重要的作用是固定上层的业务语义：

| 业务操作 | 上层关注点 | 存储实现负责的内容 |
|-|-|-|
| `update_session_state` | 更新某个 Session 的 AgentState | 定位记录、序列化、提交或刷新 TTL |
| `upsert_message` | 保存当前消息快照 | 插入新消息或更新相同 ID 的消息 |
| `list_messages` | 按 Session 读取消息 | SQL 查询或 Redis List 遍历 |
| `get_message` | 按消息 ID 查找 | 复合主键查询或 List 反向扫描 |

源码位置：[`_base.py:401-454`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_base.py#L401-L454)

## 二、关联关系不等于相同的数据结构

一个 Session 通常只有一份配置和一份当前 `AgentState`，但会持续产生多条 Message。两类数据都包含 `session_id`，却具有不同的数据特征：

| 判断角度 | Session | Message |
|-|-|-|
| 数量关系 | 一个 Session 一条当前记录 | 一个 Session 对应多条消息 |
| 生命周期 | 随会话创建、更新和终止 | 随每轮对话持续追加 |
| 更新方式 | 读取当前记录后替换状态 | 新消息插入，同一回复可多次更新 |
| 查询方式 | 按 Session ID 获取当前状态 | 按 Session 分页、排序或按消息 ID 定位 |

这也是判断数据是否应该放在一起时更可靠的四项依据：**数量关系、生命周期、更新时间和查询模式**。仅凭两个对象共享一个关联 ID，无法得出它们应该保存在同一行的结论。

SQL 实现将两者映射为不同表结构：

```text
SessionRow
├── id
├── created_at
├── updated_at
└── payload: SessionRecord

MessageRow
├── session_id  ┐
├── msg_id      ┘ composite primary key
├── created_at
└── payload: Msg
```

`SessionRow` 保存会话的当前快照，`MessageRow` 则使用 `(session_id, msg_id)` 作为复合主键，表达“某个 Session 中的一条稳定消息”。消息表不复用通用 Record 表结构，是因为它本质上是一个按会话组织的有序集合。

源码位置：[`_tables.py:132-163`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_sql/_tables.py#L132-L163)、[`_tables.py:289-320`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_sql/_tables.py#L289-L320)

## 三、ReplyStartEvent 创建消息，upsert_message 才执行持久化

`ReplyStartEvent` 的职责是启动一轮回复。`ChatService` 收到它后，以 `reply_id` 创建内容为空的 `AssistantMsg`：

```python
reply_msg = AssistantMsg(
    id=event.reply_id,
    name=event.name,
    content=[],
)
```

后续文本、思考和工具事件通过 `append_event()` 持续填充这条消息。整个过程发生在运行时内存中，`ReplyStartEvent` 本身没有写入数据库。

当本轮处理进入收尾阶段时，`ChatService` 才保存当前快照：

```python
async def _persist() -> None:
    if reply_msg is not None:
        await self._storage.upsert_message(
            user_id,
            session_id,
            reply_msg,
        )
    await self._storage.update_session_state(
        user_id=user_id,
        agent_id=agent_id,
        session_id=session_id,
        state=agent.state,
    )
    await self._message_bus.log_trim(events_key)
```

完整关系是：

```text
ReplyStartEvent
→ 创建空 AssistantMsg
→ 后续 Event 更新消息
→ upsert_message() 保存当前快照
```

消息 ID 在这条链路中保持不变。因此首次保存会创建记录；同一轮回复恢复执行后再次保存，会更新原来的 `MessageRow`，而不是生成另一条逻辑上重复的回复。

源码位置：[`_chat.py:674-697`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L674-L697)

## 四、同一个 upsert，在 Redis 与 SQL 中并不完全相同

Redis 使用 List 保存一个 Session 的消息。执行 `upsert_message()` 时，它只检查 List 尾部：

```python
last_raw = await client.lindex(key, -1)
if last_raw and last_msg.id == msg.id:
    await client.lset(key, -1, msg.model_dump_json())
else:
    await client.rpush(key, msg.model_dump_json())
```

这个实现建立在一项调用约束上：同一轮正在更新的回复位于消息列表尾部，不同轮次不会复用消息 ID。

SQL 实现使用 `(session_id, msg_id)` 复合主键执行数据库原生 upsert。相同主键存在时更新 `payload`，否则插入新行：

```python
values = {
    "session_id": session_id,
    "msg_id": msg.id,
    "created_at": now,
    "payload": msg.model_dump(mode="json"),
}
```

PostgreSQL 与 SQLite 使用 `ON CONFLICT DO UPDATE`，MySQL 与 MariaDB 使用 `ON DUPLICATE KEY UPDATE`。插入或更新的判断由数据库原子完成，避免应用层先查询再写入产生竞争窗口。

两种实现满足相同的上层用途，但不是逐项等价：

- Redis 只替换尾部具有相同 ID 的消息；
- SQL 可以更新表中任意具有相同复合主键的消息；
- 两者的一致性依赖相同的消息 ID 约束和调用顺序。

这说明抽象接口统一的是业务语义，而不是抹除底层系统的全部差异。

源码位置：[`_redis_storage.py:957-973`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_redis_storage.py#L957-L973)、[`_storage.py:1116-1155`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/storage/_sql/_storage.py#L1116-L1155)

## 五、shield 保护收尾顺序，但不构成跨对象事务

`ChatService` 将消息写入、Session 状态更新和 Event 日志裁剪放在同一个 `_persist()` 协程中，并通过 `asyncio.shield()` 等待它完成。即使外层任务收到取消信号，也会先等待持久化任务结束，再释放 Session 锁。

这项设计保护了应用层的执行顺序：

```text
保存 AssistantMsg
→ 更新 AgentState
→ 裁剪已处理 Event
→ 释放 Session 锁
```

但它不等同于一项覆盖全部操作的存储事务。SQL 的 `upsert_message()` 与 `update_session_state()` 分别建立 Session 并提交；Redis 也由多次独立命令完成。如果进程在两个调用之间直接终止，仍可能出现消息已经写入、AgentState 尚未更新的中间状态。

因此可以把当前保证分为两层：

1. **协程取消层面**：`shield` 避免正常取消在收尾阶段中断持久化；
2. **进程故障层面**：依赖稳定消息 ID、Event 日志和恢复流程识别并修复未完成状态。

将“取消安全”与“事务原子性”分开，是理解这段代码的重要前提。

## 六、SQL 适配器还承担可移植性约束

SQL 实现没有把 PostgreSQL 作为唯一目标。表结构使用普通 JSON 字段，不依赖 JSONB、生成列或 `FOR UPDATE`；upsert 则根据数据库方言生成原生语句。

这项选择降低了 SQLite、PostgreSQL、MySQL 与 MariaDB 之间的结构差异，但也意味着业务筛选主要围绕显式列和主键进行，复杂 JSON 查询不是当前抽象的重点。

从工程边界看，这是一种明确的取舍：

- `StorageBase` 保持稳定的业务操作；
- 表结构只提升通用查询需要的 ID 和时间字段；
- 具体方言差异留在 SQL Adapter 内部；
- Message 采用专用表结构，不强制套用通用 Record 模型。

## 七、从这段实现可以提取的设计判断

Agent 系统设计存储层时，可以先按以下顺序判断：

1. 业务层真正需要的是领域操作，还是底层数据库能力？
2. 两类数据是否具有相同的数量关系、生命周期、更新时间与查询模式？
3. 流式处理中变化的是 Event、聚合快照，还是两者都需要持久化？
4. upsert 的稳定标识是什么，恢复执行时是否会复用它？
5. 应用层顺序、取消安全与数据库事务分别提供了什么保证？

AgentScope 在这一链路中的核心不是同时支持 Redis 和 SQL，而是让 Event、Message、SessionState 与存储实现各自承担不同职责：

```text
Event             表达一次增量变化
AssistantMsg      表达一轮回复的当前快照
SessionState      表达 Agent 的可恢复状态
StorageBase       表达业务层持久化语义
Storage Adapter   表达具体存储系统的实现约束
```

这些边界使流式执行可以逐步变化，也使服务端能够在请求结束、取消或恢复时找到稳定的持久化对象。

</details>
