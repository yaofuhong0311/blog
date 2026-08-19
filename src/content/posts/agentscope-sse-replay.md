---
title: AgentScope 源码调研（八）：SSE 重连只恢复观察
published: 2026-07-30
description: 浏览器断线不应重新运行 Agent；共享事件流、单调游标和消息快照共同恢复客户端观察位置。
tags: [AgentScope, AI Agent, SSE, 源码分析]
category: 源码调研
---

> SSE 连接与 Agent 执行具有不同生命周期。浏览器断线时，Producer 应继续运行；客户端重连只恢复尚未看到的事件，不能重新提交用户消息或再次执行 Tool。

## 执行与连接必须解耦

如果 HTTP 连接关闭就取消 Agent，网络波动会改变业务结果；如果重连时重新启动 Agent，已经生效的外部动作可能重复。

更合理的结构是：

```text
独立 Agent Producer
→ 共享 Event Stream
→ 一个或多个 SSE Consumer
```

Producer 由 Session 执行权和 Checkpoint 管理，SSE 只是观察通道。新服务副本也能从共享流继续发送，不依赖原连接所在进程。

## 单调 Event ID 构成重放游标

Redis Stream 的条目 ID 单调递增，可以直接映射为 SSE `id`。浏览器重连携带 `Last-Event-ID`，服务端从该位置之后继续读取：

```text
SSE id: 1723456789000-0
→ 连接中断
→ Last-Event-ID: 1723456789000-0
→ XREAD 读取更大的 ID
```

重放必须允许重复投递，客户端按 Event ID 去重。若游标早于保留窗口，服务端要明确返回 Replay Gap，并让客户端回退到已持久化 Message 快照，而不是假装事件仍然完整。

## 三类状态承担不同恢复目标

| 状态 | 恢复目标 |
| --- | --- |
| Event Replay | 客户端尚未看到的增量 |
| Message History | 刷新后可读取的聚合内容 |
| Agent Checkpoint | 执行从哪里继续 |

Event Stream 不能替代 Checkpoint，因为它不一定保存完整运行状态；Checkpoint 不能替代客户端游标，因为它不知道页面最后展示到哪里；Message 快照能恢复结果，却不能重现逐步动画。

没有游标时也不应默认重放完整历史。首次打开页面更适合读取 Message 快照，再从 Event Stream 当前尾部订阅新事件；完整回放应由显式接口表达。

## 我的判断：重连协议必须声明保留边界

我会把 Producer、Event Stream 与 SSE Consumer 分开，使用共享单调游标，定义保留周期、去重规则和 Replay Gap 回退路径。

代价是需要维护事件存储和客户端游标。若响应短且不产生外部副作用，连接失败后整次重试可以更简单；只要任务长、工具可能产生副作用或客户端可能跨副本重连，就必须保证“恢复观察不等于重新执行”。

<details>
<summary>关键依据</summary>

- [`AgentScope` 事件订阅入口](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/app/_service/_chat.py#L60-L72)
- [WHATWG Server-sent events](https://html.spec.whatwg.org/dev/server-sent-events.html)
- [Redis XREAD](https://redis.io/docs/latest/commands/xread/)
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)

</details>
