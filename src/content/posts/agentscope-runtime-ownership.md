---
title: AgentScope 源码调研（七）：从 Session Lock 到可验证的执行所有权
published: 2026-08-12
description: 以 AgentScope 的 Session Lock 为起点，讨论多副本 Agent Runtime 为什么还需要所有权令牌、写入 Fence、每轮重建与跨副本取消。
tags: [AgentScope, AI Agent, AI Infra, 分布式系统]
category: 源码调研
---

> **结论先行：** 以 AgentScope 的 Session Lock 为起点，讨论多副本 Agent Runtime 为什么还需要所有权令牌、写入 Fence、每轮重建与跨副本取消。

![从 Session Lock 到可验证的执行所有权](/images/posts/agentscope-runtime-ownership.svg)

## 快速阅读

### 一、先统一两套 Runtime 的术语

不同 Agent 框架对相似对象使用不同名称。比较实现之前，需要先比较语义：

### 七、HITL 需要可持久化的消费权

等待用户确认或外部结果时，系统需要保存的不只是 actionid，还包括：

### 十二、最终判断

AgentScope 当前实现的优势是概念集中：Session Lock、Message Bus、AgentState 与 ToolCallState 构成了相对清晰的控制模型，适合理解一个可恢复 Agent Runtime 的主要组成。

<details>
<summary>展开完整分析与实现依据</summary>

> 本文是「AgentScope 源码调研」系列第 7 篇，接着[第 4 篇](/posts/agentscope-session-recovery/)对 Session 执行控制的分析，将 AgentScope 放入更严格的生产运行时约束中重新审视。AgentScope 源码仍固定在提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。

上一篇讨论了 Message 与 Session 如何持久化。这一篇回到多副本执行中更基础的问题：

> 分布式锁已经保证同一 Session 只有一个执行者，为什么系统仍可能出现两个副本同时写入？

原因在于，锁描述的是共享协调系统当前承认谁拥有执行资格，却不能立即终止旧副本中的计算，也不能自动阻止旧副本继续访问数据库、Workspace 或外部 Tool。

当租约过期、网络恢复或进程暂时停顿时，旧执行者与新执行者可能短暂重叠。生产级 Agent Runtime 因此不能只维护“锁是否存在”，还要让所有权成为一组可核验、可传递并能约束写入的状态。

## 一、先统一两套 Runtime 的术语

不同 Agent 框架对相似对象使用不同名称。比较实现之前，需要先比较语义：

| 通用语义 | AgentScope | 一种生产 Runtime 实现 |
|-|-|-|
| 一次连续执行 | Run | Turn |
| 持续存在的对话 | Session | Thread |
| 唯一执行资格 | Session Lock | Turn Guard |
| 可恢复模型状态 | AgentState | Checkpoint |
| 等待外部确认 | ToolCallState | Approval Record |
| 当前执行者定位 | Cancel Dispatcher + 广播 | Owner Registry + 定向取消 |
| 客户端观察执行 | Message Bus Replay/Live | SSE Producer/Subscription |

两类系统都不只是 Agent loop，也不只是包裹模型调用的 Harness。它们都需要处理执行所有权、状态恢复、事件传输、Tool 协议和故障收尾，只是控制强度与数据模型不同。

这种术语映射还有一项实际作用：比较架构时应针对同一层对象，不能用一个框架的 Session 与另一个系统的 HTTP 请求直接比较。

## 二、AgentScope 的 Session Lock 保证什么

AgentScope 通过 Message Bus 为 `session_id` 获取分布式锁：

```python
async def session_run(self, session_id: str):
    async with self.acquire_lock(
        self._SESSION_LOCK_KEY.format(sid=session_id),
        ttl_secs=self._SESSION_RUN_TTL_SECS,
    ):
        yield
```

它建立了两个重要约束：

1. 集群中同一 Session 同时只有一个 Run 进入执行区；
2. Run 的最终持久化在释放 Session Lock 之前完成，避免后一个执行者在前一个写回之前进入。

源码位置：[`_base.py:490-501`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/message_bus/_base.py#L490-L501)、[`_chat.py:674-697`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L674-L697)

但租约锁包含一个隐含前提：旧执行者在失去租约后能够及时停止。如果进程因为长时间 GC、事件循环阻塞或网络分区而错过续租，它可能尚未观察到自己已经失去所有权。

```text
副本 A 获得租约并开始执行
→ A 暂时无法续租
→ 租约到期
→ 副本 B 获得新租约并恢复执行
→ A 恢复运行，仍持有旧内存状态
```

此时协调系统只承认 B，但 A 的 Python Task 并不会因为 Redis 中的 key 已过期而自动消失。如果 A 继续写数据库，就会出现旧执行者覆盖新状态的问题。

因此，分布式锁解决的是“谁应该执行”，不是“谁仍然能够写入”。

## 三、所有权令牌不应只是一个布尔值

更严格的实现会把一次执行的身份与持有期显式记录下来：

```text
ExecutionIdentity
  tenant_id
  thread_id
  session_id
  turn_id

ExecutionOwner
  identity
  owner_id
  owner_nonce
  owner_epoch
  expires_at
```

这些字段承担不同职责：

| 字段 | 作用 |
|-|-|
| `owner_id` | 标识当前执行副本 |
| `owner_nonce` | 区分同一副本先后两次不同的持有期 |
| `owner_epoch` | 表示所有权变更的单调递增版本 |
| `turn_id` | 将控制操作限制在一次具体执行 |
| `expires_at` | 支持故障后的租约回收 |

只有完整字段仍然匹配时，执行者才能续租、释放或响应取消请求。

`owner_id` 不能单独承担这项职责。一个 Pod 可以连续执行多个 Turn；如果迟到的停止请求只携带 Pod 标识，它可能取消同一 Pod 后来开始的另一项任务。`owner_nonce` 与 `turn_id` 用于区分具体持有期，`owner_epoch` 则用于把所有权变化传递到持久化层。

## 四、为什么需要 reserved → active 两阶段

如果所有权同时存在于协调系统和多个持久化 Store 中，获取执行权就不再是一次 Redis 写入。

可以将状态转换分为两个阶段：

```text
acquire
  没有活动记录
  → 创建 reserved 所有权

advance fences
  → 推进 Checkpoint Fence
  → 推进 Memory Fence
  → 推进 Approval Fence
  → 推进 Workspace Fence

activate
  所有 Fence 均接受新 epoch
  → reserved 变为 active
```

预留状态表示“候选执行者已经在协调层获得位置，但还不能开始业务写入”。只有所有相关 Store 都接受新的 `owner_epoch` 后，系统才激活这次执行。

如果在推进某个 Fence 时失败，可以撤销 reservation。这样不会形成以下中间状态：

```text
Redis：副本 B 已拥有执行权
PostgreSQL：仍接受副本 A 的旧 epoch
Workspace：尚未切换到副本 B
```

两阶段所有权本质上是在多个非事务资源之间建立一个明确的激活边界。它不是分布式事务，但比“先抢到锁，再逐步初始化”更容易判断失败后谁可以继续执行。

## 五、Store Fence 阻止旧执行者继续写入

Fence 将 `owner_epoch` 写入每个需要保护的 Store。执行者更新 Checkpoint、Memory、Approval 或 Workspace 元数据时，必须在写入路径核验 epoch：

```text
写入请求携带 owner_epoch
→ 读取当前 Store Fence
→ 请求 epoch == 当前 epoch？
   是：允许写入
   否：拒绝旧 Owner
```

这与乐观并发控制类似，但冲突对象不是某一行数据版本，而是整个执行所有权版本。

Store Fence 的价值体现在旧副本恢复运行的场景：

```text
副本 A：owner_epoch = 17
副本 B：接管后推进为 owner_epoch = 18
副本 A：恢复并尝试写入 epoch 17
Store：拒绝
```

即使 A 没有及时收到取消通知，只要所有关键写入面都核验 Fence，它就无法覆盖 B 已接管的状态。

这里的关键限制是“所有关键写入面”。只保护 Checkpoint，却没有保护长期 Memory 或共享 Workspace，旧执行者仍可能从未受保护的路径产生副作用。Fence 必须沿着实际写入链路逐项覆盖，而不是只存在于执行入口。

## 六、每轮重建比长期驻留更适合多副本

多副本 Agent 服务不应依赖某个进程中长期存在的 Session 对象。更稳定的做法是每次执行重新装配：

```text
读取 Thread / Session 配置
→ 读取 Checkpoint
→ 读取未完成 Approval
→ 解析 Workspace 与 HOME
→ 构造 Agent、Toolkit 和订阅关系
→ 执行当前 Turn
→ 持久化后释放内存对象
```

这里的“无状态副本”不是没有内存状态。Agent、Task、Tool 和事件订阅在执行期间仍然存在；准确含义是这些对象只服务当前执行，结束后可以销毁，下一次请求能在任意合格副本上从外部状态重建。

AgentScope 的 `ChatService.run()` 也会读取 Session、解析 Workspace、构造 Toolkit 与 Agent，然后进入 Run。当前快照中的一个边界是：`SessionRecord` 在进入 Session Lock 之前读取和参与装配。

```text
副本 A：锁外读取状态 S0，等待锁
副本 B：持有锁，执行并写回 S1，释放锁
副本 A：随后获得锁，但继续使用此前读取的 S0
```

因此，**互斥执行不自动保证状态新鲜度**。更严格的路径应在获得执行权之后重新读取可变状态，或者在写回时用版本号、CAS 或 Fence 拒绝基于旧快照产生的更新。

这项判断来自调用顺序，而不是对分布式锁能力的否定。AgentScope 已经保证执行区互斥和锁内持久化；需要进一步处理的是进入执行区之前已经读取的可变数据。

## 七、HITL 需要可持久化的消费权

等待用户确认或外部结果时，系统需要保存的不只是 `action_id`，还包括：

- 它属于哪个 Thread 与 Turn；
- 哪一次 Tool Call 发起了等待；
- 当前 Approval 状态；
- 哪个 Owner 有资格消费结果；
- 是否已经被领取或完成；
- 过期与审计信息。

AgentScope 将等待状态直接表达在 `ToolCallState` 中：

```text
ASKING    等待用户确认
SUBMITTED 等待外部执行结果
FINISHED  已完成
```

恢复请求由 Wakeup Dispatcher 重新触发 Run。这种设计强调 Tool 当前处于哪个阶段。

另一种实现是将确认请求保存为独立的 Approval Record，并通过 compare-and-set 领取。它强调外部确认如何在多副本中被安全消费。两者解决的是相同问题，但数据模型关注点不同：

| 模型 | 主要问题 |
|-|-|
| Tool 状态 | 当前 Tool 执行到哪个阶段 |
| Approval Record | 哪个执行者可以消费这次外部决定 |

当产品需要审批历史、超时策略、跨 Turn 恢复或操作审计时，独立持久化的 Approval 模型通常更容易扩展。

## 八、取消路径也必须核验所有权

AgentScope 的停止请求使用广播：所有副本接收 Session 标识，真正持有本地 Task 的副本执行取消。这种方式依赖共享控制频道，结构直接，不要求停止方先查询 Owner。

源码位置：[`_chat.py:226-284`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L226-L284)

当系统已经维护完整所有权记录时，也可以采用定向取消：

```text
定位当前 Active Owner
→ 向 Owner 副本发送 Cancel
→ Owner 核验 turn_id / owner_nonce / owner_epoch
→ 取消本地 Agent Task
→ 返回确认结果
```

核验完整所有权可以阻止迟到请求影响新 Turn：

```text
停止请求针对 Turn-17
→ Turn-17 已结束
→ 同一 Thread 已开始 Turn-18
→ 所有权字段不匹配
→ 返回 owner_changed，不取消 Turn-18
```

广播与定向路由不是简单的优劣关系。广播减少 Owner 定位依赖，定向路由可以提供更精确的结果分类与确认；选择取决于控制面是否已经维护可靠的 Active Owner 记录。

## 九、执行与客户端连接应当解耦

长时间 Agent 执行不应依附于一次 SSE 连接。客户端断线只表示观察者离开，不必等同于取消生产任务。

更合理的关系是：

```text
Producer
  独立运行 Agent
  持续写入可重放 Event

Subscription
  从游标读取历史 Event
  追随实时 Event
  断开后可以重新连接
```

AgentScope 的 Message Bus 同时维护 replay log 与 live channel，SSE 客户端可以先读取历史，再订阅实时事件。生产执行与观察连接由此分离。

这种结构要求明确至少三个游标：

1. Agent 当前执行到哪里；
2. Event 已持久化到哪里；
3. 客户端已经消费到哪里。

如果只有第三个游标，客户端重连时无法判断服务端是否遗漏事件；如果只有 Event 日志，也无法替代 Agent Checkpoint 恢复模型执行。

## 十、应用能力与部署状态需要分别验证

Runtime 可以实现：

- 新请求拒绝进入 draining 副本；
- 已归属当前副本的执行继续收尾；
- 取消和恢复控制仍然可用；
- 超过 deadline 后取消剩余任务；
- 所有权与状态均可跨副本恢复。

这些代码能力不等于生产环境已经采用多副本滚动部署。副本数、更新策略、readiness、终止宽限期和外部依赖都可能仍按单副本模型配置。

因此，判断一套 Agent 服务是否真正支持无状态多副本，需要分别检查：

| 层面 | 需要验证的内容 |
|-|-|
| 代码 | 所有权、Fence、恢复、取消与 Drain |
| 配置 | 副本数、更新策略、探针与终止期限 |
| 运行时 | 跨副本路由、共享存储与权限 |
| 测试 | 接管、旧 Owner 拒写、断线重连与滚动发布 |

“代码中存在 Graceful Drain”只能证明应用具备相应机制，不能直接证明生产部署已经完成迁移。

## 十一、两类 Runtime 仍然共有的边界

无论采用 Session Lock 还是所有权令牌，以下问题仍需独立处理。

### 外部 Tool 的 exactly-once

锁、Fence 与 Approval 只能说明 Agent 记录到哪里，不能证明邮件、支付或第三方任务是否已经发生。外部 Tool 仍需使用 `tool_call_id` 或 `idempotency_key` 去重，并提供结果查询接口。

### Event 日志不能替代 Checkpoint

Event 服务于客户端观察和消息归并，Checkpoint 服务于模型执行恢复。二者可以相互校验，但不能假设有 Event 就一定能恢复任意内部状态。

### 持久化顺序不等于原子提交

消息、Checkpoint、Memory、Approval 与 Event 可能分布在不同存储系统。应用层可以规定写入顺序和补偿策略，却不能把多个独立提交描述成一个数据库事务。

### Fence 只保护已覆盖的写入路径

任何绕过 Fence 的后台任务、管理接口或外部写入，都可能重新引入旧 Owner 写入风险。安全边界取决于完整写入面，不取决于 Fence 类型是否存在。

## 十二、最终判断

AgentScope 当前实现的优势是概念集中：Session Lock、Message Bus、AgentState 与 ToolCallState 构成了相对清晰的控制模型，适合理解一个可恢复 Agent Runtime 的主要组成。

所有权令牌、Store Fence、独立 Approval 与定向取消进一步解决了生产多副本中的具体失效模式，但也会增加状态数量、组件边界与验证成本。

从这两类实现中可以提取一条递进关系：

```text
互斥锁
→ 带身份的租约
→ 单调递增的所有权版本
→ 各写入面的 Fence
→ 每轮从外部状态重建
→ 可验证的取消、恢复与 Drain
```

系统是否需要走到最后一层，不应由组件数量决定，而应由故障模型决定：如果旧副本可能在租约过期后恢复写入，仅有分布式锁就不足以构成完整的执行所有权。

</details>
