---
title: AgentScope 源码调研（十）：Memory 为什么不等于历史消息
published: 2026-08-18
description: 从 AgentState 与 Long-term Memory Middleware 的源码出发，区分 Message、Checkpoint、Memory 和 RAG，并分析记忆检索、上下文注入与写回的真实生命周期。
tags: [AgentScope, AI Agent, Memory, 上下文工程]
category: 源码调研
draft: false
---

> **结论先行：** 从 AgentState 与 Long-term Memory Middleware 的源码出发，区分 Message、Checkpoint、Memory 和 RAG，并分析记忆检索、上下文注入与写回的真实生命周期。

![Message、AgentState、Long-term Memory 与 RAG 的边界](/images/posts/agentscope-memory-boundaries.svg)

## 快速阅读

### 一、四类信息恢复的对象不同

最直接的判断方法不是看“它能否进入 Context”，而是问：

### 五、三种控制模式改变谁来决定读写

Mem0Middleware 提供三种 mode：

### 结语

Memory 与历史消息的区别，不在于是否持久化，而在于系统希望跨越什么边界恢复信息。

<details>
<summary>展开完整分析与实现依据</summary>

> 本文是「AgentScope 源码调研」系列第 10 篇。上一篇讨论了[从 Tool Visibility 到可信执行边界](/posts/agentscope-trusted-execution/)，这一篇转向另一个容易混淆的边界：Agent 看到过的信息，是否都应该成为长期记忆？

本文源码固定在 AgentScope 提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。

在一个持续运行的 Agent 系统中，以下内容都可能在某个时刻进入模型上下文：

- 当前对话中的 UserMsg、AssistantMsg 和 ToolResult；
- 用于恢复未完成任务的 AgentState 或 Checkpoint；
- 从历史会话提炼出的长期记忆；
- 从文档、代码和制度中检索出的外部知识。

它们最终都可能表现为模型输入，因此容易被统称为“Memory”。但从系统设计角度看，它们保存的对象、生命周期、更新规则和可信度并不相同。

如果把这些状态合并成一个存储层，短期结果会重复进入上下文，未确认推断可能被固化为事实，外部知识与用户偏好也会失去独立的更新周期。

## 一、四类信息恢复的对象不同

| 类型 | 主要保存什么 | 典型生命周期 | 主要用途 |
| --- | --- | --- | --- |
| Message History | 用户和 Agent 原始说过什么 | 当前 Session 或保留期内 | 维持对话语义 |
| AgentState / Checkpoint | 当前执行到哪里、如何继续 | 一次任务或一次 Reply | 故障恢复与中断续跑 |
| Long-term Memory | 跨 Session 可复用的事实、偏好和经验 | 长期，但需要更新与遗忘 | 个性化和经验复用 |
| RAG Knowledge | 产品文档、代码、制度等外部知识 | 独立于单次会话 | 为当前问题补充依据 |

最直接的判断方法不是看“它能否进入 Context”，而是问：

> 系统重启后，我们希望恢复的是原始对话、未完成执行、跨会话事实，还是外部知识？

当前 ReAct 循环马上要使用的 ToolResult、文件内容和中间结论，应保留在 Message 或 AgentState；尚未完成的 ToolCall 应由 Checkpoint 恢复；跨 Session 仍然稳定有效的信息才适合进入 Long-term Memory；产品资料和代码则由 RAG 独立管理。

Long-term Memory 不是 Message History 的完整副本。完整复制会产生四个问题：

1. 同一信息在历史消息和记忆中重复出现；
2. 后续修正与旧记忆发生冲突；
3. 临时信息持续占用 Token；
4. 对话中的未确认推断被错误提升为长期事实。

## 二、AgentState 已经承担执行上下文

AgentScope 的 [`AgentState`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/state/_state.py) 明确保存：

```python
class AgentState(BaseModel):
    session_id: str
    summary: str | list[TextBlock | DataBlock]
    context: list[Msg]
    reply_context: ReplyContext
    permission_context: PermissionContext
    tool_context: ToolContext
    tasks_context: TaskContext
    middle_context: dict[str, Any]
```

这里的 `context` 是尚未压缩的对话上下文，`summary` 是压缩后仍需提供给模型的信息，`reply_context` 保存当前 Reply 的标识和 ReAct 迭代位置，其他字段分别维护权限、工具、任务和 Middleware 的运行状态。

这说明 AgentState 的核心目标是让 Agent 当前执行保持连续，而不是维护跨会话的长期知识。

例如：

- 当前 ToolCall 是否仍在等待外部结果，属于执行状态；
- 文件读取缓存是否仍有效，属于 ToolContext；
- 当前任务清单和 Reply 迭代次数，属于 AgentState；
- 用户长期偏好的输出语言，才更接近 Long-term Memory。

将 ToolCall 中间结果写入长期记忆，既不能替代 Checkpoint，也可能让一次失败执行影响后续会话。

## 三、长期记忆通过 Middleware 接入

固定提交下的 [`_longterm_memory`](https://github.com/agentscope-ai/agentscope/tree/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/middleware/_longterm_memory) 目录导出三种实现：

```python
from ._agentic_memory import AgenticMemoryMiddleware
from ._mem0 import Mem0Middleware
from ._reme import ReMeMiddleware
```

这表明长期记忆并没有被写入 ReAct 循环的核心步骤，而是作为 Middleware 扩展 Agent 行为。

Agent 初始化时会按 Middleware 是否实现对应 Hook，分别建立 `on_reply`、`on_reasoning`、`on_acting`、`on_model_call` 和 `on_system_prompt` 等调用链。Memory 选择 `on_reply`，因为一次 Reply 正好提供了完整的读写边界：

```text
Reply 开始前：根据新请求检索相关记忆
Reply 执行中：将检索结果注入 Context
Reply 完成后：从本轮交互提炼并写回
```

这种设计有两个直接收益：

- 核心 ReAct 不需要依赖具体记忆后端；
- Memory 可以观察完整的一轮，而不是在每次 Model 调用前重复检索。

## 四、Mem0Middleware 的真实读写顺序

[`Mem0Middleware.on_reply()`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/middleware/_longterm_memory/_mem0/_middleware.py) 的主路径可以概括为六步。

### 1. 从新输入提取查询文本

Middleware 先从 `input_kwargs["inputs"]` 提取当前用户查询。没有可检索文本时，不执行自动搜索。

### 2. 在 ReAct 开始前检索

检索使用 `user_id` 作为基本命名空间，并可进一步使用 `agent_id` 限定范围：

```python
filters = {"user_id": user_id}
if agent_id:
    filters["agent_id"] = agent_id
```

这不是附加优化，而是多用户 Agent 系统的基本隔离条件。缺少稳定命名空间时，语义检索可能把另一个用户或另一个 Agent 的记忆注入当前上下文。

### 3. 等待 ReplyStartEvent 后注入

检索可以提前完成，但 Middleware 不会立刻修改 Context。它等待 `ReplyStartEvent`，确认 Agent 已经把本轮用户输入写入 `state.context`，然后追加一个名为 `memory` 的合成消息：

```python
agent.state.context.append(
    AssistantMsg(
        name="memory",
        content=[HintBlock(hint=content)],
    ),
)
```

因此，记忆位于本轮用户消息之后、推理循环之前。Formatter 最终会把 `HintBlock` 转换成模型能够接收的协议消息。

### 4. ReAct 正常执行

一次 Reply 内部可以发生多次 Model 调用、ToolCall 和 ToolResult。自动检索只在 Reply 边界执行一次，本轮后续迭代复用已经注入的内容。

### 5. 捕获最终 AssistantMsg

Middleware 只在调用链返回过程中记录最终的 Assistant 消息。Tool 事件或中间文本不会直接触发自动写回。

### 6. Reply 结束后写回

在 `finally` 中，只有同时存在查询文本和最终 AssistantMsg，并且回复包含文本内容时，Middleware 才会调用写入：

```python
if query_text and final_msg is not None:
    assistant_text = final_msg.get_text_content()
    if assistant_text:
        await self._dispatch_write(...)
```

![AgentScope Memory Middleware 的读写生命周期](/images/posts/agentscope-memory-lifecycle.svg)

这个条件能够避免没有形成最终回复的执行被自动写入，但它仍不等于“写入内容已经被业务确认”。最终 AssistantMsg 可能包含推断、建议或随后会被用户纠正的信息。源码提供了写回时机，业务系统仍需定义什么内容具备长期价值。

## 五、三种控制模式改变谁来决定读写

`Mem0Middleware` 提供三种 `mode`：

### static_control

Middleware 在每次 Reply 前自动检索，并在 Reply 后自动写回。Agent 不会看到记忆 Tool。

适合调用方希望统一管理记忆行为的场景，但需要严格控制自动写入质量和 Context 预算。

### agent_control

Middleware 不在 Reply 路径中自动检索或写回，而是向 Agent 暴露 `search_memory` 和 `add_memory` Tool，并在 System Prompt 中说明用法。

这种方式让模型按需决定是否访问记忆，但读写决策会受到模型判断稳定性影响，执行端仍需校验命名空间、数据范围和写入内容。

### both

同时启用自动检索和记忆 Tool。它提供最高灵活性，也最容易产生重复检索或重复写入，因此需要在 Prompt 和 Tool 规则中明确职责。

这三种模式不是后端能力差异，而是控制权分配差异。

## 六、自动写回不等于完整记忆治理

从源码可以确认，框架已经解决了：

- Memory 后端如何通过 Middleware 接入 Agent；
- 检索结果在什么时刻进入 Context；
- 如何按用户和 Agent 划分查询范围；
- 自动控制与 Agent 控制如何组合；
- 同步等待写入与后台写入如何选择。

但以下问题仍属于业务系统：

### 1. 什么值得长期保存

长期稳定的偏好、用户明确确认的事实和多次验证有效的经验可以成为候选。临时任务参数、中间 ToolResult、模型推断和未授权动作不应直接进入长期记忆。

### 2. 如何处理冲突与纠正

“用户喜欢简洁回答”和“用户希望详细解释”可能来自不同任务，也可能代表偏好已经变化。系统需要记录来源、时间、适用范围和版本，而不是只保留最后一个文本片段。

### 3. 如何删除和遗忘

用户要求删除、数据超过保留期、来源失效或事实被纠正时，记忆必须能够定位和撤销。只有写入接口而没有更新、删除与审计能力，不能构成完整治理。

### 4. 如何限制注入成本

源码注释明确指出，自动检索产生的记忆消息会保留在 `state.context` 中，长会话可能每轮累积一份，最终依赖 Context Compression 或调用方主动清理。

因此，检索的 `top_k`、相似度阈值、去重、压缩和 Token 预算都应成为显式配置。

### 5. 如何防止记忆成为新的输入风险

长期记忆会影响后续决策，其可信度应按外部输入处理。写入前需要权限和敏感性检查，读取后需要来源标记，不能让一条历史文本获得高于当前系统策略的优先级。

## 七、如果由我设计生产记忆层

我会在 Middleware 提供的读写生命周期之外，增加以下约束。

### 1. 先保存候选，再提升为已确认记忆

记忆至少包含 `candidate`、`confirmed`、`deprecated` 三种状态。模型提取结果先进入候选区，经过用户确认、规则校验或重复证据支持后再进入稳定检索集合。

### 2. 每条记忆保留来源与作用域

除正文外，还应记录：

- `tenant_id`、`user_id` 和可选的 `agent_id`；
- 来源 Session、Message 或 ToolResult；
- 创建时间、更新时间和过期时间；
- 事实、偏好、经验或约束等类型；
- 敏感级别与删除状态。

这些字段使冲突处理、审计和遗忘成为可能。

### 3. 检索一次，按整轮复用

一次 Agent Run 开始时检索与当前任务最相关的记忆，并在本轮复用。除非用户目标发生明显变化，否则不在每次 Model 调用前重新查询，避免延迟、成本和上下文抖动。

### 4. 只从可确认结果写入

失败、取消或停在等待确认状态时，优先保存 Checkpoint。对尚未完成的动作只记录执行状态，不把预期结果写成长期事实。

### 5. 把更正和删除作为首要能力

记忆系统的可靠性不只取决于召回率，也取决于错误记忆能否及时更正和彻底删除。如果没有稳定的删除边界，不应扩大自动写入范围。

## 结语

Memory 与历史消息的区别，不在于是否持久化，而在于系统希望跨越什么边界恢复信息。

- Message History 恢复原始对话；
- AgentState 与 Checkpoint 恢复未完成执行；
- Long-term Memory 恢复跨会话的稳定事实与经验；
- RAG 恢复独立维护的外部知识。

AgentScope 通过 Middleware 把长期记忆放在 Reply 的前后边界：开始前检索并注入，结束后观察最终回复并写回。这个扩展点保持了 ReAct 核心的独立性，也清楚暴露出平台仍需承担的职责。

真正困难的部分不是把文本存入向量库，而是决定哪些内容值得长期存在、如何处理冲突、如何限制注入成本，以及如何在信息失效时完成更正与遗忘。

---

源码索引：

- [`AgentState`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/state/_state.py)
- [`Agent` Middleware 装配](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/agent/_agent.py)
- [`Mem0Middleware`](https://github.com/agentscope-ai/agentscope/blob/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/middleware/_longterm_memory/_mem0/_middleware.py)
- [Long-term Memory Middleware 目录](https://github.com/agentscope-ai/agentscope/tree/698297b4c084e1c3954e35f06fa737a96a515275/src/agentscope/middleware/_longterm_memory)

</details>
