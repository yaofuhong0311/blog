---
title: AgentScope 源码调研（一）：Session 为什么不能依赖原进程
published: 2026-07-29
description: 服务端会话要跨重启、跨副本继续运行，必须把状态、工作区和唤醒机制移出进程。本文从 AgentScope 源码提炼这条边界。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> Agent 服务重启后，为什么还能继续同一个 Session？核心不是“重新创建 Agent 对象”，而是：**继续执行所需的事实都不能只存在于原进程中。**

AgentScope 的服务端实现把 Agent 定义、会话状态、工作区和运行触发分别持久化，再由任意副本重新组装一次执行。这使 Session 属于服务，而不是某个 Worker。

## 恢复对象不只有历史消息

一次会话恢复至少涉及三类状态：

| 状态 | 保存什么 | 缺失后的结果 |
| --- | --- | --- |
| Agent 定义 | 模型、Prompt、工具和配置 | 无法重新构造相同行为 |
| AgentState | Message、Reply 位置、工具与任务上下文 | 不知道执行到哪里 |
| Workspace | 文件、产物和运行环境 | 上下文记得文件，实际文件却不存在 |

三者需要共同恢复，却不适合强行写入同一对象。Agent 定义变化较少，AgentState 随 Reply 更新，Workspace 又有独立的存储与回收周期。

因此，“支持 Session 持久化”不能只看是否保存 Message。真正需要验证的是：新的副本能否从外部存储重新得到一致的 Agent、State 与 Workspace。

## 唤醒信号不是状态来源

服务端会话可能因为新消息、外部任务完成或子 Agent 上报而重新运行。AgentScope 使用共享队列与信号通知副本，再由调度器尝试启动对应 Session。

这里最重要的边界是：

> 队列负责通知“需要检查”，持久化状态负责说明“现在应该做什么”。

如果唤醒消息本身携带唯一状态，一旦重复、乱序或丢失，Session 就无法可靠恢复。更稳妥的方式是让消息只提供 Session ID，消费者重新读取 Inbox、AgentState 和 Action 状态。

会话锁也只解决当前哪个副本可以运行。它不能替代持久化状态，更不能说明恢复时应该传入普通消息、确认结果还是外部执行结果。

## 恢复输入必须保留语义

“继续执行”并不是一种统一动作。

| 中断位置 | 恢复输入 |
| --- | --- |
| 等待用户确认 | `UserConfirmResultEvent` |
| 用户主动打断 | `UserInterruptEvent` |
| 等待外部任务 | `ExternalExecutionResultEvent` |
| 普通新消息 | `Msg` |

如果恢复层只保存一段文本，Agent Loop 无法区分“用户说了 yes”和“这是对上一项操作的正式确认”。因此 Checkpoint 除了位置，还要保留中断原因和稳定 Action 身份。

多 Agent 也遵守同一原则。子 Agent 可以被建模为独立 Session：执行期间 Leader 不必持续占用线程；Worker 上报进入持久化 Inbox 后，再唤醒 Leader 重新运行。

这使多副本成为可能，但代价是队列、状态、锁和工作区必须采用一致的 Session 身份。

## 我从源码中得到的判断

我会把服务端 Session 设计成“可重新组装的运行”，而不是“长期存活的进程对象”：

```text
触发到达
  → 获取 Session 执行权
  → 读取定义、状态与 Workspace
  → 执行一次 Reply
  → 保存状态并释放执行权
```

这套结构适合进程重启、跨副本路由和长时间等待。但它仍然不能自动证明：

- 旧持有者恢复后的写入一定会被拒绝；
- 外部 Tool 副作用具有幂等或 Reconcile；
- Action 在跨进程 HITL 中具有稳定身份；
- Workspace 与 AgentState 的更新能够原子一致。

因此，源码中出现共享锁和持久化接口，只能证明恢复控制点存在。生产可靠性还需要故障注入验证。

<details>
<summary>实现依据：状态重建、锁与恢复事件</summary>

服务端恢复路径先从 Session 记录读取状态，再按 Agent 定义重新实例化对象：

```python
agent_state = session_record.state
agent_state.session_id = session_id

agent = self._agent_cls(
    name=agent_record.data.name,
    # model, formatter, toolkit ...
)
```

共享锁使用随机 Token 获取所有权，并通过心跳续租。释放时仍需校验 Token，避免旧持有者误删新锁：

```text
SET key <random-token> NX EX <ttl>
heartbeat: renew every ttl / 2
release: delete only when token matches
```

`reply()` 的输入类型保留了恢复语义，而不是统一退化成文本：

```python
Msg
| list[Msg]
| UserConfirmResultEvent
| UserInterruptEvent
| ExternalExecutionResultEvent
| None
```

这些实现共同说明：Session 恢复依赖稳定状态与事件类型，不依赖原进程中的 Agent 对象。

</details>

## 参考资料

- [AgentScope GitHub](https://github.com/agentscope-ai/agentscope)
- [AgentScope：State / Session Management](https://doc.agentscope.io/tutorial/task_state.html)
