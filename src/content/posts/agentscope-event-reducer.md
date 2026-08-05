---
title: AgentScope 源码调研（五）：Event 如何归并为可恢复的 AssistantMsg
published: 2026-08-05
description: 从 append_event() 与 ChatService 的执行顺序出发，分析 AgentScope 如何把流式 Event 归并为结构化 AssistantMsg，并支持持久化、刷新与同一轮恢复。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> 本文是「AgentScope 源码调研」系列第 5 篇，接着[上一篇](/posts/agentscope-session-recovery/)分析 [AgentScope](https://github.com/agentscope-ai/agentscope) 的消息恢复机制。源码固定在 AgentScope 主分支提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。

一次 Agent 回复在运行时不是一条完整消息，而是一组按时间到达的 Event：文本开始、文本增量、工具调用、工具结果、模型用量与回复结束。客户端需要消费这些 Event 实时渲染，存储层却需要一条可以查询、刷新和恢复的 `AssistantMsg`。

因此这里存在两个不同的数据形态：

| 数据形态 | 主要用途 | 生命周期 |
|-|-|-|
| Event | 实时传输、增量渲染、控制执行 | 短期、连续产生 |
| AssistantMsg | 查询、持久化、刷新、恢复 | 长期、持续更新 |

AgentScope 没有把 Event 原样保存为消息数组，而是让每个 Event 作为一次状态修改，持续更新同一个 `AssistantMsg`。`Msg.append_event()` 就是这条归并链路的核心。

![Event 归并为 AssistantMsg](/images/posts/agentscope-event-reducer.svg)

## 一、AssistantMsg 是结构化快照

源码中的 `AssistantMsg()` 是一个工厂函数，最终返回 `role="assistant"` 的 `Msg`。它的 `content` 不是单个字符串，而是由多种 `ContentBlock` 组成：

```text
AssistantMsg
├── TextBlock
├── ThinkingBlock
├── ToolCallBlock
├── ToolResultBlock
├── DataBlock
└── HintBlock
```

这使一条回复可以同时保存文本、思考过程、工具参数、工具结果和多模态数据。客户端刷新后不需要重新解释完整 Event 流，只需要读取已经归并完成的消息快照。

需要注意的是，这不是完整的 Event Sourcing。Event 在运行时驱动状态变化，但当前持久化对象主要是归并后的 `AssistantMsg` 和 Agent checkpoint，而不是一份可以从头重放的永久 Event 日志。

## 二、ReplyStartEvent 创建空消息

`ChatService` 从 `agent.reply_stream()` 持续读取 Event。收到 `ReplyStartEvent` 时，它使用 `reply_id` 和 Agent 名称创建一条内容为空的消息：

```python
reply_msg = AssistantMsg(
    id=event.reply_id,
    name=event.name,
    content=[],
)
```

后续 Event 不再创建新消息，而是交给 `append_event()` 修改这条消息。消息 ID 与本轮回复的 `reply_id` 相同，构成了归并过程的第一项约束。

`append_event()` 在处理任何增量前都会验证 `reply_id`：

```python
if event.reply_id != self.id:
    return self
```

这项检查避免了并发事件、延迟事件或错误路由的事件被写入另一轮回复。它不能替代上游的 Session 隔离，但可以保护单条消息的归并边界。

源码位置：[`_base.py:240-509`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/message/_base.py#L240-L509)

## 三、Block ID 决定增量写入位置

文本流通常包含三个阶段：

```text
TEXT_BLOCK_START
→ TEXT_BLOCK_DELTA × N
→ TEXT_BLOCK_END
```

START 创建空 `TextBlock`，DELTA 根据 `block_id` 定位目标块并追加文本，END 写入完成时间：

```python
block = self._find_block("text", event.block_id)
block.text += event.delta
```

这里的重要设计不是字符串追加，而是按 `block_id` 查找目标块。一次回复中，文本、思考、工具调用和工具结果可能交错出现。如果实现默认修改 `content` 的最后一项，一旦 Event 交错或异步到达，增量就可能写入错误的块。

`ThinkingBlock` 使用相同的 Start、Delta、End 模型。`DataBlock` 也采用增量归并，但二进制数据不能直接拼接 Base64 字符串：源码会先分别解码已有分片与新分片，拼接字节后再重新编码。这个细节说明“增量”只是协议形式，具体归并算法仍取决于数据类型。

## 四、ToolCall 与 ToolResult 是两条关联状态

工具调用和工具结果不是同一个 Block：

```text
ToolCallBlock
  id = tool_call_id
  name / input / state

ToolResultBlock
  id = tool_call_id
  output / state / metadata
```

`TOOL_CALL_START` 创建调用块，`TOOL_CALL_DELTA` 逐段拼接模型生成的参数，`TOOL_CALL_END` 只表示调用描述已经生成完整，不代表 Tool 已执行完成。

用户确认与外部执行事件会继续修改同一个调用块：

| Event | ToolCallState |
|-|-|
| `REQUIRE_USER_CONFIRM` | `ASKING` |
| `USER_CONFIRM_RESULT` | `ALLOWED` 或 `FINISHED` |
| `REQUIRE_EXTERNAL_EXECUTION` | `SUBMITTED` |
| `TOOL_RESULT_END` | `FINISHED` |

结果侧由 `TOOL_RESULT_START` 创建状态为 `RUNNING` 的 `ToolResultBlock`。文本结果被归并为 `TextBlock`，图片或文件被追加为 `DataBlock`；`TOOL_RESULT_END` 再写入最终状态、metadata 和完成时间。

当结果结束时，源码还会根据同一个 `tool_call_id` 找到对应的 `ToolCallBlock`，将其状态更新为 `FINISHED`。这一步让“调用描述”和“执行结果”两条状态在最终消息中闭合。

源码位置：[`_base.py:369-509`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/message/_base.py#L369-L509)

## 五、模型用量与回复结束属于消息级状态

不是所有 Event 都修改 `content`。

`ModelCallEndEvent` 累加 input/output token。一次 Agent 回复可能包含多次模型调用，例如模型先产生 ToolCall，Tool 执行后再次调用模型生成最终文本，因此这里必须累计，而不是覆盖最后一次调用的用量。

`ReplyEndEvent` 则结束整条消息，写入：

- `finished_at`
- `finished_reason`
- `error`

Block 的完成状态与消息的完成状态不能混在一起。一个 `TextBlock` 已经结束，不代表整个回复已经结束；后面仍可能继续产生 ToolCall、ToolResult 或新的文本块。

## 六、先归并，再发布

`ChatService` 对每个 Event 的处理顺序是：

```python
reply_msg.append_event(event)
await publish_session_event(...)
```

即先同步修改内存中的消息快照，再异步发布 Session Event 和执行投影。这样即使取消发生在后续 `await` 期间，已经生成的 Event 也不会从待持久化消息中丢失。

完整顺序可以表示为：

```text
Agent 产生 Event
→ 同步归并到 reply_msg
→ 发布实时 Event
→ 更新投影
→ finally 中持久化消息与 AgentState
```

持久化发生在 Session Run Lock 释放之前。否则另一个 Worker 可能先获得执行权，却读取到旧的消息与 AgentState。

当回复流异常结束且没有产生 `ReplyEndEvent` 时，`ChatService` 会合成一个错误结束事件，同时归并到 `reply_msg` 并发布出去。实时客户端因此可以结束加载状态，刷新后的消息也能看到一致的错误原因。

源码位置：[`_chat.py:563-690`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L563-L690)

## 七、同一轮恢复继续修改原消息

如果回复停在用户确认或外部执行阶段，恢复请求不会创建新的 `AssistantMsg`。`ChatService` 根据 `agent.state.reply_id` 从存储中取回原消息：

```text
读取原 AssistantMsg
→ 归并确认结果或外部执行结果
→ 继续消费 reply_stream
→ 使用相同消息 ID 执行 upsert
```

所以恢复的是同一轮回复，而不是创建一条“恢复后的新回复”。这一点对前端展示和消息查询都很重要：

- 用户确认前后的 ToolCall 属于同一条消息；
- 外部结果返回后，原 ToolCall 与 ToolResult 在同一结构中闭合；
- 数据库通过稳定消息 ID 更新原记录；
- 客户端刷新后看到的是连续的结构化结果。

这与上一篇讨论的 Session、Q&A 和 Worker 生命周期形成对应关系：Worker 可以更换，执行可以中断，但同一轮回复通过稳定 `reply_id` 和持久化 `AssistantMsg` 保持连续。

## 八、可以迁移的工程判断

这套实现可以抽象成一个 Reducer：

```text
初始状态：空 AssistantMsg
输入：按时间到达的 Event
归并函数：append_event(message, event)
输出：当前可持久化的 AssistantMsg 快照
```

它成立需要五项约束：

1. **稳定的聚合标识**：`reply_id` 决定 Event 属于哪条消息；
2. **稳定的子对象标识**：`block_id` 与 `tool_call_id` 决定增量写入位置；
3. **明确的状态迁移**：Start、Delta、End 和确认事件不能只靠到达顺序推断；
4. **归并早于异步发布**：避免取消或发布失败造成快照缺失；
5. **稳定 ID 的 upsert**：同一轮恢复必须继续更新原消息。

最终可以得到一个更准确的结论：

> **Event 是运行时的状态修改，AssistantMsg 是这些修改归并后的可恢复快照；恢复能力来自稳定标识、确定性归并和持久化顺序，而不是来自流式传输本身。**

