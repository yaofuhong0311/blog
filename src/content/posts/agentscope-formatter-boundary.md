---
title: AgentScope 源码调研（三）：Formatter 稳定的是内部消息语义
published: 2026-07-30
description: AgentScope 先统一 Msg 与 ContentBlock，再由 Formatter 适配模型协议；抽象价值在于阻止供应商差异进入 Agent Loop。
tags: [AgentScope, AI Agent, 源码分析, 架构]
category: 源码调研
---

> Formatter 的主要价值不是少写几次字段转换，而是让 Agent Loop 只依赖稳定的 `Msg` 与 `ContentBlock`。OpenAI、Anthropic 和 Gemini 的协议差异与拒绝条件，由各自 Formatter 在边界处吸收。

## 内部消息先表达语义

AgentScope 内部使用统一 `Msg`，内容由文本、思考、工具调用、工具结果和多模态块组成。Agent 与 Memory 可以围绕这些语义工作，而不需要知道某家 API 使用 `tool_calls`、`tool_use` 还是 `functionCall`。

调用路径可以概括为：

```text
Agent / Memory
→ Msg 与 ContentBlock
→ Formatter
→ 供应商请求结构
→ Model API
```

如果内部直接保存供应商响应，切换模型时不仅要改请求客户端，还会影响历史消息、工具配对和持久化格式。

## Formatter 同时处理结构与合法性

同一个 ToolCallBlock 在不同协议中会变成不同字段、角色和嵌套层级。除此之外，Formatter 还需要处理目标 API 的拒绝条件：

- 某些思考块不能原样跨供应商回放；
- 空文本在部分协议中不是合法内容；
- 工具结果中的图片和文件需要移动到特定消息位置；
- 多 Agent 消息的名称与角色可能需要重新编码。

这些分支不是 Agent 业务逻辑，而是协议兼容规则。把它们集中在 Formatter 中，才能保证其他模块看到的仍是统一语义。

## 三种设计视角不能混为一个模式

从上层看，调用者只使用统一 `format(msgs)`，具有门面效果；从协议转换看，每个 Formatter 是一个 Adapter；从运行时装配看，不同模型选择不同实现，又接近 Strategy。

这些名称只是解释不同观察位置。真正的边界是：

> 内部语义模型保持稳定，外部协议变化只修改对应 Formatter。

如果新增供应商时仍要修改 Agent Loop、Memory 或 Tool 状态，说明协议细节已经越过边界。

## 我的判断：稳定语义比统一字段更重要

我会先定义内部消息必须表达的语义，再为每家模型编写独立适配与兼容测试。不会为了追求字段一一对应，把供应商特有结构直接扩散到核心状态。

代价是内部模型无法无损表达所有厂商特性，部分思考内容或多模态结构必须降级。只有当某项特性对核心行为不可缺少时，才扩展 `ContentBlock`；单一供应商的偶然字段应留在 Adapter 内。

<details>
<summary>关键源码路径</summary>

- [`FormatterBase`](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_formatter_base.py#L22-L51)
- [`OpenAI Formatter` 工具转换](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_openai_formatter.py#L278-L288)
- [`Anthropic Formatter` 兼容处理](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_anthropic_formatter.py#L84-L122)
- [`Gemini Formatter` 兼容处理](https://github.com/agentscope-ai/agentscope/blob/807390be1ceed6915d521c58566a37c192d77adc/src/agentscope/formatter/_gemini_formatter.py#L156-L218)

</details>

下一篇进入恢复边界：[Session 执行权与 Tool 状态如何配合](/posts/agentscope-session-recovery/)。
