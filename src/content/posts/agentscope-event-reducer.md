---
title: AgentScope 源码调研（五）：Event 如何归并为可恢复消息
published: 2026-07-30
description: AgentScope 先把流式 Event 归并到稳定 AssistantMsg，再发布与持久化快照，使刷新和同轮恢复不必重放完整事件。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> 流式 Event 适合表达“刚刚发生了什么”，却不适合作为客户端刷新和故障恢复的唯一状态。AgentScope 通过稳定的消息 ID 与 Block ID，把增量 Event 归并为一条结构化 `AssistantMsg`，再持久化当前快照。

![Event 归并为 AssistantMsg](/images/posts/agentscope-event-reducer.svg)

## AssistantMsg 是恢复快照

一条 AssistantMsg 可以同时包含文本、思考、工具调用、工具结果和多模态数据：

```text
AssistantMsg
├─ TextBlock
├─ ThinkingBlock
├─ ToolCallBlock
├─ ToolResultBlock
└─ DataBlock
```

`ReplyStartEvent` 创建具有稳定 `reply_id` 的空消息。后续 Event 不创建新的逻辑回复，而是持续修改这条消息中的 ContentBlock。

因此客户端刷新后可以直接读取消息快照，不需要从头解释全部流式事件。这里采用的是运行时归并，不是依赖永久 Event Log 的完整 Event Sourcing。

## Block ID 决定增量落点

文本与思考内容可能分片到达，工具调用和工具结果也在不同时间产生。Reducer 通过 Block ID 找到原块并追加或更新，而不是依赖数组最后一个元素。

这使恢复后的同一轮执行可以继续修改原消息：

```text
开始回复 → 创建 reply_id
文本分片 → 更新 TextBlock
工具调用 → 写入 ToolCallBlock
工具结果 → 关联 tool_call_id
回复结束 → 更新消息级状态
```

工具调用与结果仍是两个关联块，不能因为界面上显示为一组就合并存储。稳定调用 ID 是协议配对与恢复判断的共同依据。

## 先归并，再对外发布

如果系统先向客户端发送 Event，再更新内存快照，进程恰好在两者之间崩溃，用户可能已经看到内容，而持久化状态却没有对应记录。

AgentScope 的路径先让 Event 修改 `AssistantMsg`，再把事件发布给订阅者，并在收尾阶段保存消息与 AgentState。这个顺序减少了“展示内容领先于可恢复状态”的窗口，但消息、Session State 与 Event Trim 仍不构成一个跨存储原子事务。

因此恢复逻辑仍要允许重复通知和最后一小段 Event 丢失，以持久化消息与 Checkpoint 为事实来源。

## 我的判断：流与状态必须分工

我会让 Event Stream 服务于实时体验，让聚合消息与 Checkpoint 服务于查询和恢复。Event 必须携带稳定的回复、Block 和 ToolCall 标识，Reducer 处理重复与同轮续写。

代价是同一信息同时存在增量事件和聚合快照中，并需要明确持久化顺序。若业务只需要一次性非流式响应，可以直接保存最终消息；只要存在刷新、断线重连或中途工具调用，就需要稳定快照而不能只依赖流。

<details>
<summary>关键源码路径</summary>

- [`Msg.append_event()` 与 ContentBlock 归并](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/message/_base.py#L240-L509)
- [`ChatService` 的回复处理顺序](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L563-L690)

</details>
