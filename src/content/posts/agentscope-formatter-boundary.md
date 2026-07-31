---
title: AgentScope 源码调研（三）：Formatter 如何隔离内部语义与模型协议
published: 2026-07-30
description: 从 Msg、ContentBlock 与三家模型协议的转换路径出发，分析 AgentScope Formatter 的职责边界，以及 Facade、Adapter、Strategy 三种设计视角。
tags: [AgentScope, AI Agent, 源码分析, 架构]
category: 源码调研
---

> 本文是「AgentScope 源码调研」系列第 3 篇，接着[上一篇](/posts/agent-tools-execution-plane/)继续分析 [AgentScope](https://github.com/agentscope-ai/agentscope) 的源码。前两篇分别讨论服务端会话与工具执行，本篇关注模型请求发出前的最后一层转换：Formatter。

Formatter 容易被理解为一组字段映射函数：OpenAI 使用 `tool_calls`，Anthropic 使用 `tool_use`，Gemini 使用 `function_call`，逐一改名即可。

源码呈现的职责比字段映射更完整。Formatter 处理的是**内部语义模型与外部协议模型之间的边界**：角色如何映射、内容块如何重组、工具参数是否需要解析、思考内容能否回传、多模态工具结果放在哪一条消息中，以及目标 API 对消息顺序有哪些限制。

这层边界建立后，Agent、Middleware、Memory 与 Tool 可以持续使用同一种内部消息，不需要随模型供应商变化。

## 一、先稳定内部语义，再适配外部协议

AgentScope 在内部统一使用 `Msg`。一条消息主要包含 `name`、`role` 与 `content`，其中 `content` 不是单一字符串，而是一组具有明确语义的 `ContentBlock`：

```python
Msg(
    name="Planner",
    role="assistant",
    content=[
        TextBlock(text="先分析需求"),
        ToolCallBlock(
            id="call-1",
            name="search",
            input='{"query":"AgentScope"}',
        ),
    ],
)
```

这里保留的是业务语义：

- `Planner` 是消息来源；
- 当前消息属于 assistant；
- 第一部分是文本；
- 第二部分要求调用 `search`，调用标识为 `call-1`，参数是流式累积得到的 JSON 字符串。

内部模块只需要理解这些含义，不需要知道目标 API 最终采用 `content`、`parts` 还是独立的 `tool_calls` 字段。

`FormatterBase` 提供的公共约束也很小：

```python
class FormatterBase(BaseModel):
    input_types: list[str] = Field(
        default_factory=lambda: ["text/plain"],
    )

    @abstractmethod
    async def format(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        ...
```

上层依赖的是统一的 `format(...)` 入口和输入能力声明，而不是任一供应商的消息类型。  
源码位置：[`_formatter_base.py:22-51`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_formatter_base.py#L22-L51)

## 二、Formatter 位于调用链的哪一层

完整调用链可以压缩为：

```text
Agent / Middleware / Memory / Tool
                ↓
              Msg[]
                ↓
       选择具体 Formatter
                ↓
       formatter.format(msgs)
                ↓
   某一家 API 要求的 messages / input
                ↓
       Model 客户端发送网络请求
```

三个模块的职责并不重叠：

| 模块 | 负责的决策 |
|---|---|
| Agent 循环 | 何时调用模型、何时执行工具、何时结束 |
| Formatter | 如何把相同消息语义合法地表示为目标 API 请求 |
| Model | 客户端、鉴权、网络请求、重试、流式响应与用量统计 |

因此，Formatter 不应选择业务工具，不应执行工具，也不应发送网络请求。它可以决定“同一条工具结果如何表示”，不能决定“哪一条工具结果应当发送”。

这个边界很重要。如果 Formatter 开始删除它认为不重要的业务内容，协议适配就会变成不可追踪的上下文策略；如果 Model 客户端自行拼装消息，协议差异又会重新扩散到调用链中。

## 三、同一个 ToolCallBlock，三种目标结构

同一个 `ToolCallBlock` 进入不同 Formatter 后，业务含义没有变化，外部表示却明显不同。

OpenAI Formatter 保留 JSON 字符串，把调用放入 `tool_calls`：

```python
tool_calls.append(
    {
        "id": block.id,
        "type": "function",
        "function": {
            "name": block.name,
            "arguments": block.input,
        },
    },
)
```

源码位置：[`_openai_formatter.py:278-288`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_openai_formatter.py#L278-L288)

Anthropic Formatter 将它变成 `tool_use` 内容块，而且 `input` 必须是对象：

```python
content_blocks.append(
    {
        "type": "tool_use",
        "id": block.id,
        "name": block.name,
        "input": _json_loads_with_repair(
            block.input or "{}",
        ),
    },
)
```

源码位置：[`_anthropic_formatter.py:165-180`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_anthropic_formatter.py#L165-L180)

Gemini Formatter 则生成 `parts` 中的 `function_call`：

```python
parts.append(
    {
        "function_call": {
            "id": block.id,
            "name": block.name,
            "args": _json_loads_with_repair(
                block.input or "{}",
            ),
        },
    },
)
```

源码位置：[`_gemini_formatter.py:203-218`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_gemini_formatter.py#L203-L218)

这里至少存在三类适配：

| 适配类型 | 具体差异 |
|---|---|
| 字段适配 | `tool_calls`、`tool_use`、`function_call` |
| 类型适配 | OpenAI 接收参数字符串；Anthropic 与 Gemini 需要对象 |
| 结构适配 | 独立消息字段、内容块、`parts` 三种组织方式 |

`_json_loads_with_repair` 还说明了一个运行时事实：工具参数可能来自被中断的流式响应或经过压缩的上下文，JSON 字符串不一定完整。Formatter 不只是改变字段，还要把内部数据修复为目标协议可接受的类型。

## 四、兼容性规则也是协议的一部分

供应商协议的差异不仅体现在正常结构上，还体现在拒绝条件上。Formatter 中有大量分支并非业务逻辑，而是目标 API 的合法性约束。

### 1. 思考内容不能直接跨供应商回放

Anthropic 的 thinking block 要求有效签名。来自其他供应商的 `ThinkingBlock` 没有该签名，直接发送会被拒绝，因此实现只保留带签名的内容：

```python
signature = getattr(block, "signature", None)
if signature:
    content_blocks.append(
        {
            "type": "thinking",
            "thinking": block.thinking,
            "signature": signature,
        },
    )
else:
    logger.debug(
        "Dropping ThinkingBlock without signature; "
        "Anthropic requires a valid signature.",
    )
```

源码位置：[`_anthropic_formatter.py:84-122`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_anthropic_formatter.py#L84-L122)

Gemini 的处理方式不同。它把思考内容放入普通 `parts`，同时增加 `thought: true`：

```python
if block.thinking:
    parts.append(
        {"thought": True, "text": block.thinking},
    )
```

源码位置：[`_gemini_formatter.py:156-167`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_gemini_formatter.py#L156-L167)

这意味着“思考内容”可以是统一的内部语义，但不能假设它具有可跨供应商复制的外部表示。

### 2. 空文本也可能导致请求失败

Anthropic 会拒绝空的 text block。工具调用轮次可能没有可见文本，流式累积后产生空 `TextBlock`，因此 Formatter 在输出前过滤：

```python
if isinstance(block, TextBlock):
    if block.text:
        content_blocks.append(
            {"type": "text", "text": block.text},
        )
```

源码位置：[`_anthropic_formatter.py:74-82`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_anthropic_formatter.py#L74-L82)

### 3. 工具结果中的多模态内容需要重新定位

工具结果可能同时包含文本、图片或音频。目标模型如果支持对应输入类型，`FormatterBase` 会把多模态块提升为后续 user message；如果不支持，则把 URL 或本地文件位置转换为文本提示。

这一设计背后的约束是：某些 API 允许模型接收图片，却不允许图片直接出现在工具结果结构中。**数据能力与消息位置是两项独立约束。**

源码位置：[`_formatter_base.py:70-173`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_formatter_base.py#L70-L173)

类似规则还包括：

- Gemini 把内部 `assistant` 角色映射为 `model`；
- `HintBlock` 作为循环运行期间新注入的指令，需要形成 user message，而不是伪装成历史 assistant 输出；
- 并行工具结果需要保持在协议允许的连续结构中，不能任意拆成多条消息。

这些规则共同说明：**协议适配的对象不是字段，而是一组带有顺序、角色、能力与合法性约束的消息语义。**

## 五、Chat 与 MultiAgent 是另一项独立维度

每个供应商下面又分别存在 `XxxChatFormatter` 与 `XxxMultiAgentFormatter`。这不是重复实现，而是在处理另一项与供应商无关的差异：

| 维度 | 可选值 |
|---|---|
| 目标协议 | OpenAI / Anthropic / Gemini |
| 会话参与者 | user + 当前 agent / 多个具名 agent |

普通聊天可以依赖 user 与 assistant 的角色交替。多 Agent 会话还需要保留 `Planner`、`Reviewer`、`Coder` 等说话者身份，而供应商协议通常没有为任意数量的 agent 提供独立角色。

AgentScope 没有把所有消息统一转换为一段历史文本，而是先分组：

```python
async for typ, group in self._group_messages(msgs[start_index:]):
    match typ:
        case "tool_sequence":
            formatted_msgs.extend(
                await self._format_tool_sequence(group),
            )
        case "agent_message":
            formatted_msgs.extend(
                await self._format_agent_message(group),
            )
```

`agent_message` 会被编码成带说话者名称的 `<history>` 文本；`tool_sequence` 仍交给对应的 ChatFormatter，保留供应商原生工具调用结构：

```python
async def _format_tool_sequence(self, msgs):
    return await OpenAIChatFormatter(
        input_types=self.input_types,
    ).format(msgs)

# 普通消息仍保留说话者身份
accumulated_text.append(f"{msg.name}: {block.text}")
```

源码位置：[`_openai_formatter.py:395-457`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_openai_formatter.py#L395-L457)

这是一项有边界的降级策略：

```text
普通 Agent 消息  →  带身份的 history 文本
工具调用序列      →  供应商原生工具协议
普通 Agent 消息  →  带身份的 history 文本
```

如果把工具调用也合并进自然语言历史，模型只能“读到曾经调用过工具”，却无法继续依赖结构化的调用标识、参数与结果关系。分组转换保留了协议中需要机器解析的部分。

## 六、Facade、Adapter 与 Strategy 分别描述哪一面

用一个设计模式概括整个 Formatter 容易造成误解。三个模式描述的是不同观察位置：

| 观察位置 | 对应模式 | 依据 |
|---|---|---|
| 上层调用者 | Facade 的使用效果 | 只调用统一的 `format(msgs)` |
| 具体协议转换 | Adapter | 内部 `Msg` 被转换为不兼容的供应商结构 |
| 运行时装配 | Strategy | 根据模型与场景选择具体 Formatter |

严格来说，`FormatterBase` 不是经典 Facade。经典 Facade 通常由一个具体对象包装多个子系统并在内部路由；这里是统一抽象接口，每个具体 Formatter 只处理一种协议与一种会话场景。

因此更准确的表述是：

> 对上形成统一门面，对下由多个 Adapter 完成协议转换，运行时通过可替换实现完成 Strategy 式选择。

设计模式在这里用于说明职责，不应替代对实际调用链的判断。

## 七、这层抽象真正保护的是什么

Formatter 保护的不是“以后可以少写几次字段映射”，而是内部语义模型的稳定性。

当供应商新增内容块、调整角色规则或限制工具结果结构时，变化应当收敛在对应 Formatter；Agent 循环仍然只处理 `Msg`，Memory 仍然保存统一消息，Middleware 仍然检查统一内容块，Tool 仍然返回统一结果。

反过来，如果内部直接存储某一家 API 的 message：

1. 记忆数据会与供应商协议绑定；
2. 中间件必须理解多套字段；
3. 工具结果需要在执行阶段提前选择目标格式；
4. 切换模型不再是替换客户端，而是迁移整条消息链路。

所以这一模块最重要的工程结论是：

> **内部表示负责保存稳定语义，Formatter 负责吸收外部协议变化；二者之间的边界越清晰，模型供应商的变化就越难扩散到 Agent 主循环。**

这也解释了 Formatter 中大量看似细小的兼容分支。它们不是附加处理，而是协议边界存在的主要原因。

[下一篇](/posts/agentscope-session-recovery/)分析 Session 执行控制与 Tool 恢复：CAS、Pub/Sub、checkpoint 和幂等性分别解决什么问题。
