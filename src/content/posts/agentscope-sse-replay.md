---
title: AgentScope 源码调研（八）：SSE 断线后为什么不应该重新运行 Agent
published: 2026-08-13
description: 从 Producer、共享事件流与浏览器游标三个层次分析 Agent 流式响应的断线恢复，并区分事件重放、消息历史与执行状态恢复。
tags: [AgentScope, AI Agent, AI Infra, SSE, Redis Stream]
category: 源码调研
---

> 本文是「AgentScope 源码调研」系列第 8 篇，接着[上一篇](/posts/agentscope-runtime-ownership/)讨论执行所有权之后，继续分析客户端断线时 Agent Runtime 应该保存什么。AgentScope 源码固定在提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。

Agent 正在输出文本或执行 Tool 时，浏览器可能刷新页面、切换网络或进入休眠。连接恢复之后，用户通常希望继续看到遗漏的内容。

这里容易出现一个错误设计：将 SSE 连接视为 Agent 执行本身。连接断开时取消任务，重新连接时再次提交用户输入。这不仅会浪费模型调用，还可能让外部 Tool 被重复执行。

完整的断线恢复至少包含三个相互独立的问题：

1. **Producer 是否继续执行**：浏览器离开以后，Agent 任务是否仍然存在？
2. **Event 是否可以补发**：断线期间产生的展示事件保存在哪里？
3. **Subscriber 从哪里继续**：客户端如何准确表达自己最后收到的事件？

![Agent 流式响应的三层断线恢复](/images/posts/agentscope-sse-replay.svg)

## 一、SSE 连接不是 Agent 执行

一次流式请求通常同时包含两种生命周期：

| 对象 | 开始条件 | 结束条件 |
|-|-|-|
| Agent Producer | 服务接受本轮执行 | Agent 完成、失败或被明确取消 |
| SSE Subscription | 客户端建立连接 | 页面关闭、网络断开或服务端关闭连接 |

两者可能同时开始，却不应该互相拥有。

如果 HTTP Handler 直接在响应生成器中运行 Agent，客户端断开会取消生成器，进而取消模型调用和 Tool。更稳定的设计是让 Producer 成为独立任务，SSE 连接只订阅它产生的事件：

```text
用户提交消息
→ 创建独立 Producer
→ Producer 驱动 Agent 和 Tool
→ Event 写入共享事件流
→ 一个或多个 Subscription 读取 Event
```

这使“离开页面”与“停止任务”成为两个明确操作。前者只移除当前观察者，后者才进入 Runtime 的取消控制路径。

需要注意的是，Producer 独立只能保证任务继续执行。它不能单独保证浏览器回来后看到断线期间的每一个 Event；如果 Event 只发往当前连接，没有 Subscriber 时产生的内容仍会丢失。

## 二、事件重放属于哪一层

AgentScope 将 Event 的生产、实时分发和短期重放集中在 Message Bus：

```text
ChatService
→ publish_session_event()
→ Replay Log
→ Live Channel
→ SSE Session Stream
```

`ChatService.run()` 不把 Event 直接返回给发起请求，而是发布到 Message Bus。客户端通过独立的 Session Stream 接口读取。源码也明确将 Event 同时写入 replay log 和 live Pub/Sub channel。

源码位置：[`_chat.py:60-72`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L60-L72)

另一种常见架构会把职责分开：

```text
Agent Runtime
  负责 Producer 持续执行
        ↓
Protocol Adapter
  将内部 Event 转换成前端协议
        ↓
Shared Event Stream
  保存面向产品界面的 Event
        ↓
Browser Subscription
  按游标补发并追随新 Event
```

这种拆分让 Agent Runtime 不必绑定具体前端协议。Adapter 可以合并文本增量、补充生命周期事件，并将内部 Tool Event 转换成前端真正消费的数据结构。

代价是端到端保证跨越更多边界：

```text
上游产生 Event
→ 协议转换成功
→ 共享事件流写入成功
→ SSE 编码成功
→ 浏览器保存游标
```

任何一段失败，都可能形成用户可见的事件缺口。能力放在 Runtime 内部时闭环更紧凑；放在独立接入层时职责更清楚，但必须对整条交付链路做验证。

## 三、持久化的不是每一个模型 Token

模型 SDK 返回的最小增量，不一定适合作为产品事件永久保存。协议适配层通常会进行：

- 文本增量合并；
- 高频 Event 节流；
- Tool 参数和结果的结构化转换；
- 开始、完成、失败等生命周期补充；
- 内部字段过滤。

因此事件流保存的对象更准确地说是**已经交付给前端的协议事件**，而不是模型产生的每一个 token。

这一点影响恢复语义。如果前端断线后重放事件流，它恢复的是产品界面应该看到的变化；它不应依赖这些 Event 重建模型内部的全部执行状态。

```text
模型增量
  ↓ 合并 / 节流 / 转换
产品 Event
  ↓ 写入 Event Stream
SSE Event
```

这种设计还能控制事件数量。若每个 token 都执行一次跨网络写入，Redis、日志与浏览器渲染都会承担不必要的压力。合并窗口需要在实时性和写入成本之间取得平衡，但不改变游标必须对应“实际交付事件”的原则。

## 四、Redis Stream ID 可以直接成为 SSE 游标

Redis Stream 为每个条目分配单调递增的 ID。写入端通过 `XADD` 获得 ID，读取端使用 `XREAD` 请求指定 ID 之后的条目。Redis 官方文档也说明，`XREAD` 返回 ID 大于给定位置的记录。

这与 SSE 的 `id` 字段和 `Last-Event-ID` 请求头可以自然对应：

```text
XADD stream * event=<payload>
← 1723456789000-0

SSE:
id: 1723456789000-0
event: message
data: {...}

连接中断

GET /stream
Last-Event-ID: 1723456789000-0

XREAD STREAMS stream 1723456789000-0
```

浏览器重新连接时，服务从该 ID 之后继续读取，不需要重新提交用户消息，也不会重新运行 Tool。WHATWG 的 SSE 规范将 `Last-Event-ID` 定义为重建连接时向服务端报告最后事件 ID 的请求头；Redis Stream 的 ID 则提供了共享、可排序的读取位置。

参考：[WHATWG Server-sent events](https://html.spec.whatwg.org/dev/server-sent-events.html)、[Redis XREAD](https://redis.io/docs/latest/commands/xread/)、[Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)

## 五、共享事件流使重连不依赖原副本

如果 Event 只保存在进程内队列，重连请求必须回到原 Pod，才能读取断线期间的内容。多副本系统很难长期维持这项粘性要求：

```text
第一次连接 → Pod A
断线
Producer 仍在 Pod A 运行
重新连接 → Pod B
Pod B 没有 Pod A 的进程内事件
```

共享 Redis Stream 将读取位置从 Pod 内存移到外部状态：

```text
Pod A 写入 Session Stream
Pod B 读取同一个 Session Stream
浏览器只携带 Stream ID
```

这使任意合格副本都可以承接重连请求。系统仍可能在每个 Pod 保留 Live Bus 以降低在线连接延迟，但跨副本恢复必须以共享状态为准。

当 Redis 不可用时，退化到进程内 Live Bus 可以继续服务当前 Pod 上仍在线的连接，却不能再承诺：

- 事件已经持久化；
- 重连可以补发；
- 连接能切换到另一副本；
- 故障期间不存在事件缺口。

降级策略需要在接口和监控中被识别，不能把“当前连接仍能收到数据”描述成完整的断线恢复。

## 六、没有游标时不应该默认重放全部历史

游标存在时，服务可以确定客户端最后收到的位置。没有游标时，含义并不明确：

- 这是首次打开页面；
- 浏览器丢失了本地状态；
- 客户端不支持游标；
- 用户明确请求查看历史。

一种稳妥的默认策略是从 Stream 当前尾部开始，只订阅未来事件：

```text
有 Last-Event-ID
→ 从该 ID 之后补发
→ 追随新事件

没有 Last-Event-ID
→ 读取当前尾部 ID
→ 只等待新事件
```

长期历史应该来自数据库中的 Message 或 Block 记录，而不是把 Session 的全部细粒度 Event 重新播放给新连接。

这样可以避免两个问题：

1. 页面首次打开时重放大量已经归并完成的增量；
2. Event 保留期与产品历史保留期被错误绑定。

如果产品确实需要从头回放一次执行，应使用显式参数或独立接口，而不是让“缺少游标”隐式表达完整重放。

## 七、游标过旧时必须承认 Replay Gap

Redis Stream 通常会设置长度限制或保留期限。`XADD` 支持 `MAXLEN` 或 `MINID` 裁剪，但被删除的条目无法再由旧游标读取。

例如：

```text
客户端最后收到：100-0
Stream 当前最早事件：160-0
客户端请求从 100-0 继续
```

服务可以返回 `160-0` 之后尚存的事件，却不能证明 `101-0` 到 `159-0` 从未存在。如果系统没有显式检查“请求游标早于当前最小 ID”，客户端会在不知情的情况下接受一段不完整的增量序列。

因此，事件重放协议需要定义 Replay Gap：

| 情况 | 可提供的保证 |
|-|-|
| 游标仍在保留范围内 | 补发游标之后的已保存事件 |
| 游标早于最小 ID | 明确告知存在缺口，并刷新持久化消息快照 |
| Event 写入前故障 | 事件流无法重放尚未成功写入的 Event |
| Redis 降级为进程内总线 | 只能提供当前连接的实时事件 |

Gap 不一定要作为错误终止连接。更实用的处理可以是：

```text
检测到 Replay Gap
→ 返回 gap / reset 控制事件
→ 客户端重新加载 Message 快照
→ 从 Stream 当前位置继续订阅
```

关键是不能在缺乏证据时承诺“完全没有遗漏”。

## 八、Event Replay、Message History 与 Checkpoint 是三份状态

断线恢复经常混淆三种对象：

| 状态 | 主要读者 | 解决的问题 |
|-|-|-|
| Event Replay | 在线客户端 | 断线期间界面遗漏了哪些增量 |
| Message History | 用户和业务查询 | 刷新页面后有哪些完整消息 |
| Agent Checkpoint | Runtime | 模型执行应该从哪里继续 |

三者可以来自同一轮执行，但不能互相替代。

### Redis Stream 不能替代 Checkpoint

事件流只能重放已经写入的展示事件。执行副本崩溃时，Agent 还可能存在未保存的模型状态、Tool 状态或内部控制位置。恢复未完成计算仍需 AgentState、Checkpoint 与执行所有权。

### Checkpoint 不能替代前端游标

Checkpoint 可以让 Runtime 继续执行，却不知道某个浏览器已经看到哪些文本增量。没有 Subscriber 游标，服务只能重新发送或放弃补发。

### Message 快照不能提供逐步动画

完整 `AssistantMsg` 适合刷新页面和长期查询，但它通常已经归并文本、Tool 调用与结果。它不能精确还原每次增量的到达顺序。

合理的关系是：

```text
Event 驱动实时界面
→ Message 提供长期快照
→ Checkpoint 恢复执行状态
```

## 九、AgentScope Replay Log 的边界

AgentScope 将 replay log 和 live channel 放在 Message Bus 内，Runtime 自己掌握 Event 生产与读取。`session_run()` 结束时会执行 `log_trim()`：

```python
async with self.acquire_lock(...):
    try:
        yield
    finally:
        await self.log_trim(session_events_key)
```

源码位置：[`_base.py:490-501`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/message_bus/_base.py#L490-L501)

这说明 Replay Log 主要服务当前 Run 的短期追赶，而不是无限期 Event 历史。Run 完成后的长期恢复仍应读取已经持久化的 `AssistantMsg`。

两种能力放置方式可以这样比较：

| 方式 | 优点 | 成本 |
|-|-|-|
| Runtime 内置 Replay | 生产、缓存与重放闭环紧凑 | Runtime 承担前端事件协议职责 |
| 接入层维护共享 Stream | Runtime 与产品协议解耦，天然支持跨副本订阅 | 端到端保证跨越协议转换和更多服务 |

没有一种方式可以省略保留期、Gap 检测和 Message 快照。差异只在于这些机制由哪个边界负责。

## 十、设计断线恢复时应逐项回答

在实现 SSE Router 之前，可以先回答以下问题：

1. 客户端断开是否会取消 Producer？
2. 明确停止任务通过什么独立接口实现？
3. 哪一层负责生成面向前端的 Event？
4. Event 在返回给客户端之前是否已经进入共享存储？
5. SSE `id` 是否与可读取的共享游标一一对应？
6. 重连能否落到另一副本？
7. 没有游标时从头、从尾还是读取消息快照？
8. 游标早于保留范围时如何通知 Replay Gap？
9. Redis 不可用时降级后还保留哪些保证？
10. Event Replay、Message History 与 Checkpoint 各自保存多久？

这些问题比“是否使用 SSE”更能决定系统的实际恢复能力。

## 十一、最终判断

Agent 流式响应的断线恢复不是一个 HTTP 重连功能，而是一条跨越 Runtime、事件存储与客户端状态的协议：

```text
独立 Producer
→ Event 转换与持久化
→ 共享、单调递增的游标
→ Last-Event-ID 续读
→ Replay Gap 检测
→ Message 快照回退
```

其中最重要的边界是：

> 重新连接只恢复观察，不应重新执行业务。

只有把 Producer、Event Replay、Message History 和 Agent Checkpoint 分开，系统才能在浏览器断线、服务切换和执行副本故障三类场景中分别给出准确保证。
