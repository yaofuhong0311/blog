---
title: AgentScope 源码调研（二）：工具 Schema 为什么不是执行边界
published: 2026-07-29
description: AgentScope 用 Schema 向模型描述工具，却由函数签名、状态注入和执行器决定真实行为；两层不能合并判断。
tags: [AgentScope, AI Agent, AI Infra, 源码分析]
category: 源码调研
---

> 这篇源码调研验证一个容易混淆的问题：工具的 `input_schema` 是否等于运行时校验？AgentScope 的实现表明，Schema 主要负责向模型描述调用形式，真实执行仍由参数解析、函数签名、状态注入和执行位置共同决定。

## Schema 面向模型，函数面向执行

AgentScope 的工具参数模型会生成 JSON Schema，并随工具名称和描述一起交给模型。但执行调用时，路径更接近：

```python
kwargs = _json_loads_with_repair(tool_call.input)
if tool.is_state_injected:
    kwargs["_agent_state"] = state
result = await tool_func(**kwargs)
```

参数模型在这里没有自动执行 `model_validate()`。模型输出先经过 JSON 修复，再展开为 Python 关键字参数；名称或类型不符合函数要求时，错误由调用阶段产生并转换为 Tool Result。

因此 Schema 是接口说明和生成约束，不是完整的信任边界。需要权限、路径、数据类型或业务不变量时，工具实现仍要显式校验。

## 工具合同与执行位置相互独立

模型只选择工具名称并生成参数，不决定工具在本地进程、远程服务还是沙箱执行。相同工具合同可以接入不同执行器：

```text
ToolCall
→ 解析与校验
→ 注入 AgentState
→ 选择执行器
→ 本地函数 / 远程服务 / Sandbox
→ ToolResult
```

这条边界使 Agent Loop 不必了解底层位置，但也带来一个要求：远程执行后，超时、取消、幂等、文件状态和长期进程必须成为显式协议，不能继续依赖同进程状态。

工具名称与 Schema 解决“调用什么”，执行器解决“在哪里以及如何产生副作用”。前者不能证明后者安全，后者也不能补足含糊的工具语义。

## 状态注入是 Harness 能力

`is_state_injected` 说明部分参数不来自模型，而由 Harness 在调用前注入。这样可以避免让模型伪造 Session、用户身份或内部状态引用。

这也是工具参数需要分类的原因：

| 参数来源 | 示例 | 信任方式 |
| --- | --- | --- |
| 模型生成 | 查询词、目标路径、用户可见选项 | Schema 提示并在工具侧校验 |
| Harness 注入 | Session、AgentState、身份和租约 | 从当前运行上下文取得 |
| 执行器生成 | 外部任务 ID、退出码、产物引用 | 作为结果持久化并回传 |

如果内部身份也暴露为普通模型参数，工具合同虽然完整，授权边界却已经失效。

## 我的判断：先稳定合同，再替换执行面

我会把工具定义、参数校验、权限判断和执行器选择拆开：Schema 服务于模型选择，工具入口完成信任边界校验，Harness 注入不可伪造状态，执行器只负责可靠执行与结果返回。

代价是同一个动作会经过多层合同，远程执行还需要额外状态管理。若工具只是进程内纯函数，可以保持简单；一旦涉及外部副作用、用户身份或沙箱，就不能把 Schema 存在等同于运行时已经安全。

<details>
<summary>源码依据</summary>

- [`AgentScope` 工具与执行实现](https://github.com/agentscope-ai/agentscope)
- `_json_loads_with_repair` 负责修复并解析模型生成的 JSON。
- `is_state_injected` 决定 Harness 是否在调用前补入 `_agent_state`。
- 参数模型通过 `model_json_schema()` 生成说明，但执行路径最终调用 `tool_func(**kwargs)`。

</details>

下一篇继续看模型边界：[Formatter 如何把内部消息转换为不同供应商协议](/posts/agentscope-formatter-boundary/)。
