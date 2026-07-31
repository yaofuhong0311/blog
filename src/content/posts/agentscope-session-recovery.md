---
title: AgentScope 源码调研（四）：Session 执行控制与 Tool 恢复
published: 2026-07-31
description: 从 Session、Q&A 与 Worker 的生命周期划分出发，分析 AgentScope 如何用分布式锁、Pub/Sub、checkpoint 与 Tool 状态处理并发执行、中断和故障恢复。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> 本文是「AgentScope 源码调研」系列第 4 篇，接着[上一篇](/posts/agentscope-formatter-boundary/)继续分析 [AgentScope](https://github.com/agentscope-ai/agentscope) 的服务端实现。本篇讨论 Session 执行控制与 Tool 恢复，源码固定在 AgentScope 主分支提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。

Agent 服务进入多副本运行后，“一次请求是否执行过”不再是单进程内的变量。客户端超时可能重新提交，同一 Session 可能被多个设备使用，消息也可能因为故障转移再次进入调度队列。

这时需要先分开三个对象：

| 对象 | 含义 |
|---|---|
| Session | 持续存在的对话容器，保存对话、Memory、工具结果和可序列化上下文 |
| Q&A | Session 中一次具体的执行任务 |
| Worker | 当前承载这次 Q&A 的临时执行者，通常属于某个 svc 副本 |

同一个 Session 的下一次 Q&A 可以由另一个 Worker 执行。Session 是连续的，Q&A 和 Worker 却是可替换的。后续所有控制机制，都是围绕这个生命周期关系建立的。

## 一、问题不是“如何保存”，而是“谁有资格执行”

checkpoint 解决的是 Agent 上次保存了什么；它不能直接阻止两个副本同时执行同一个 Session。

例如，两个请求几乎同时到达不同副本：

```text
副本 A：读取 Session → 开始执行
副本 B：读取 Session → 也开始执行
```

如果两边都基于同一个旧 checkpoint 生成回复，最后写回的结果可能覆盖另一边的执行结果。即使存储层采用版本号，也只能发现冲突，不能提前授予唯一执行权。

因此执行控制要在读取 Agent checkpoint 之前建立。它回答的是：

> 当前这一轮 Q&A，哪个副本可以进入 Agent loop？

这与“Agent 上次记住了什么”是两项不同的决策。

## 二、CAS 负责 Session 的唯一执行权

AgentScope 将 Session 的执行锁放在共享 Message Bus 上。Message Bus 的抽象接口把分布式锁定义为一个异步上下文：

```python
@abstractmethod
@asynccontextmanager
async def acquire_lock(
    self,
    key: str,
    *,
    ttl_secs: int = 600,
) -> AsyncGenerator[None, None]:
    """Acquire a distributed mutex on ``key``."""
```

锁的关键性质不是“有一个锁对象”，而是多个 svc 副本都针对同一个共享 key 执行原子竞争：

```text
Session-123：空闲
副本 A：CAS 成功 → RUNNING
副本 B：CAS 失败 → 拒绝重复执行
副本 A：正常结束 → 释放锁
```

AgentScope 为 Session 生成稳定的锁 key，并设置执行租约。当前代码中的兼容入口 `session_run` 使用 `600` 秒的 Session Run TTL：

```python
async def session_run(self, session_id: str):
    async with self.acquire_lock(
        self._SESSION_LOCK_KEY.format(sid=session_id),
        ttl_secs=self._SESSION_RUN_TTL_SECS,
    ):
        yield
```

源码位置：[`_base.py:320-365`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/message_bus/_base.py#L320-L365)、[`_base.py:469-510`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/message_bus/_base.py#L469-L510)

TTL 解决的是 Worker 异常退出后的租约回收。Worker 被 OOM Kill 或进程崩溃时，没有机会主动写入“已停止”；只要它不再刷新租约，锁会在 TTL 到期后释放。

但 TTL 只说明旧 Worker 不再被认为存活，并不说明上一次 Tool 已经完成。它解决的是执行资格回收，不是外部操作的结果确认。

## 三、Pub/Sub 负责通知，不负责选主

停止请求与执行请求可能到达不同副本：

```text
副本 A：正在执行 Session-123
副本 B：收到用户的停止请求
副本 B：向共享取消频道发布 session_id
副本 A：收到消息并取消本地任务
```

停止方不需要先查询“Session 当前在哪个副本”，因为所有副本都订阅同一个控制频道。消息中只需要携带 Session 标识，收到消息的副本检查自己是否持有对应的本地执行任务。

ChatService 的 `interrupt` 路径体现了这个分支：

```python
if await self._message_bus.is_locked(
    MessageBusKeys.session_lock(session_id),
):
    await self._message_bus.publish(
        MessageBusKeys.session_interrupt_channel(),
        {"session_id": session_id},
    )
    return

await enqueue_run_trigger(
    self._message_bus,
    user_id=user_id,
    session_id=session_id,
    agent_id=agent_id,
    kind=MessageBusKeys.WAKEUP_KIND_RESUME,
    inputs=UserInterruptEvent(reply_id=session.state.reply_id),
)
```

如果 Session 仍在运行，发送中断通知；如果 Session 已经停泊在等待用户确认或外部结果的状态，则通过一次新的 resume trigger 让 Agent 处理 `UserInterruptEvent`。空闲 Session 收到中断事件时可以无操作返回，因此这条路径具有幂等性。

源码位置：[`_chat.py:226-284`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L226-L284)

这里需要严格区分两件事：

| 机制 | 解决的问题 |
|---|---|
| CAS / 分布式锁 | 哪个副本拥有执行资格 |
| Pub/Sub | 如何让停止请求抵达当前执行者 |

广播不会产生唯一执行者，唯一执行权仍由共享锁保证。

## 四、Session 状态要先看实时租约，再看持久化上下文

Session 的状态同时来自两个位置：

1. Message Bus 上的实时 Run Lock；
2. checkpoint 中最后一条 Agent 上下文。

AgentScope 的状态判断顺序是先检查锁：

```python
if await self._bus.is_locked(
    MessageBusKeys.session_lock(session_id),
):
    return SessionStatus.RUNNING

session = await self._storage.get_session(
    user_id,
    agent_id,
    session_id,
)
return self._derive_parked_status(session.state.context)
```

只要存在 Worker 持有租约，就返回 `RUNNING`，不再根据可能过期的 checkpoint 推导停泊状态。只有没有 Worker 执行时，才检查上下文末尾是否存在等待确认或等待外部结果的 Tool 调用。

源码位置：[`_session.py:139-202`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_session.py#L139-L202)

当前状态可理解为：

```text
RUNNING
  ↓ 没有 Worker 持有 Run Lock
AWAITING_PERMISSION
  ↓ 用户允许或拒绝 Tool
AWAITING_EXTERNAL_RESULT
  ↓ 外部执行结果到达
IDLE
```

其中 `RUNNING` 与后面几个状态不在同一层。前者描述集群中是否存在执行者，后者描述持久化上下文停在什么位置。

## 五、Tool 调用状态描述“执行走到哪里”

AgentScope 的 `ToolCallBlock` 与 `ToolResultBlock` 分别携带调用状态和结果状态。

```python
class ToolCallState(StrEnum):
    PENDING = "pending"
    ASKING = "asking"
    ALLOWED = "allowed"
    SUBMITTED = "submitted"
    FINISHED = "finished"

class ToolResultState(StrEnum):
    SUCCESS = "success"
    ERROR = "error"
    INTERRUPTED = "interrupted"
    DENIED = "denied"
    RUNNING = "running"
```

源码位置：[`_block.py:128-159`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/message/_block.py#L128-L159)、[`_block.py:185-214`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/message/_block.py#L185-L214)

一个典型的调用流程是：

```text
PENDING
  ├─ 需要用户确认 → ASKING → ALLOWED
  ├─ 直接允许     → ALLOWED
  └─ 拒绝或参数无效 → FINISHED

ALLOWED
  ├─ 本地 Tool     → 执行完成 → FINISHED
  └─ 外部 Tool     → SUBMITTED → 外部结果到达 → FINISHED
```

状态记录的作用是让恢复逻辑知道调用停在了哪个阶段。它不是事务系统，也不能单独保证外部动作只发生一次。

## 六、`UNKNOWN` 不是 ToolResultState，而是恢复层的判断

文档中使用 `UNKNOWN` 表示一种非常重要的情况：

```text
外部操作已经发出
        ↓
本地进程在收到结果前崩溃
        ↓
本地无法判断外部操作是否完成
```

当前 AgentScope 源码中的 `ToolResultState` 并没有 `UNKNOWN` 枚举值。这个差异本身值得记录：

- `SUCCESS`、`ERROR`、`INTERRUPTED` 等是 Tool 结果对象可以表达的状态；
- `UNKNOWN` 是恢复控制层对“本地记录与外部系统事实不一致”的判断；
- 它不应被简单伪装成 `ERROR`，因为错误意味着动作明确失败；
- 它也不能被当成 `SUCCESS`，因为外部副作用可能尚未完成。

恢复时应当按状态采取不同策略：

| 恢复状态 | 下一步 |
|---|---|
| `NOT_STARTED` | 可以重新调用 |
| `SUCCESS` | 复用结果，不重复调用 |
| `FAILED` / `ERROR` | 按明确的重试策略处理 |
| `INTERRUPTED` | 等待后续继续或终止指令 |
| `UNKNOWN` | 先查询外部系统或执行对账 |
| `RUNNING` | 结合 TTL、心跳和 owner 信息判断执行者是否仍存活 |

因此，可靠恢复的关键不是增加更多状态名称，而是保留足够信息，让系统知道“本地记录”和“外部事实”之间是否存在不确定性。

## 七、Tool 状态与幂等性不是同一件事

这两项机制经常被放在一起讨论，但回答的问题不同：

```text
Tool 状态：这次调用发生了什么？
幂等键：同一个请求再次提交，会不会重复产生副作用？
状态查询：外部系统最终是否已经完成？
```

例如，一个创建资源的外部请求已经发送，但客户端在收到响应前超时。此时：

1. 本地只能把结果视为 `UNKNOWN`；
2. 直接重试可能创建第二个资源；
3. 使用相同幂等键重试，可以让外部服务返回原请求结果；
4. 如果外部服务没有幂等键，则必须先查询资源或执行对账。

所以，Tool 层需要表达调用状态；具有外部副作用的 Tool 还需要提供幂等键或状态查询能力。AgentScope 的统一状态表达为恢复决策提供依据，但不会替外部服务实现事务语义。

## 八、Worker 崩溃后恢复的是 checkpoint，不是调用栈

Worker 崩溃后，Python 调用栈、局部变量和当前协程都不存在。新 Worker 能恢复的只有持久化数据：

```text
Worker 崩溃
→ Run Lock 不再刷新
→ TTL 到期
→ 新 Worker 获得执行资格
→ 读取最后一个可靠 checkpoint
→ 检查最后一次 Tool 状态
→ 继续、等待、查询或交由人工处理
```

不同的 checkpoint 尾部对应不同恢复路径：

| checkpoint 尾部 | 恢复动作 |
|---|---|
| 没有待处理 Tool | 加载上下文后继续执行 |
| `ASKING` | 继续等待用户确认 |
| `SUBMITTED` | 等待或查询外部执行器 |
| 结果不明确 | 标记恢复层的 `UNKNOWN`，先对账 |

“锁过期”不能被解释为“任务已经失败”，它只说明原 Worker 不再拥有有效执行租约。对于有副作用的 Tool，恢复策略必须优先避免重复操作。

## 九、连续对话与连续执行是两条不同的线

同一 Session 的第二次 Q&A 读取第一次保存的对话、Memory、Tool 结果和上下文，所以它在业务上是连续的；但在执行层面，它是一个新的任务，可以由另一个 svc 副本创建新的 Worker：

```text
同一 Session：上下文连续
不同 Q&A：执行任务分开
新的 Session ID：不会自动继承旧上下文
```

这条边界让系统可以同时获得两项能力：

- Session 可以跨副本继续；
- 单次 Q&A 仍然可以保持唯一执行权。

如果把 Session、Q&A 和 Worker 绑定成同一个生命周期，Worker 崩溃就会被误认为 Session 结束，跨副本恢复也只能重新创建整段对话。AgentScope 的分层设计避免了这种绑定。

## 十、把四种机制放回各自的位置

本章的实现可以收敛为一张职责表：

| 机制 | 保护对象 | 解决的问题 |
|---|---|---|
| CAS / Run Lock | Q&A 执行权 | 防止同一 Session 被多个副本同时执行 |
| Pub/Sub | 控制消息到达路径 | 让停止请求找到当前执行者 |
| Agent checkpoint | 对话与 Agent 上下文 | 让新的 Worker 可以继续业务状态 |
| Tool 状态 | 调用阶段与结果表达 | 让恢复逻辑知道动作停在哪里 |
| 幂等键 | 外部副作用 | 让安全重试不产生重复影响 |
| 查询与对账 | 外部真实状态 | 处理本地结果未知的情况 |

最终可以用一句话概括：

> **Run Lock 决定谁可以执行，Pub/Sub 负责通知，checkpoint 恢复 Agent 记忆，Tool 状态记录执行阶段，幂等与对账负责外部副作用。**

这几项机制可以共同使用 Redis，却不能因为存储介质相同就合并职责。可靠性来自边界清晰，而不是来自状态字段数量增加。
