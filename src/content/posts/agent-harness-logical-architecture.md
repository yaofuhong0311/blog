---
title: Agent 工程（十四）：Harness 是逻辑架构，不是部署单元
published: 2026-08-25T11:00:00+08:00
description: Harness 描述围绕 Agent Loop 的职责和合同，不规定部署拓扑；Runtime、Memory、Tool、Sandbox 与状态服务可以独立演化。
tags: [AI Agent, AI Infra, Harness, 架构]
category: Agent 工程
---

> Harness 表示围绕 Agent Loop 的运行职责，不等于名为 Harness 的单一部署单元。判断系统是否完整，应检查 Session、Run、Event、Tool 与 State 合同，而不是检查所有能力是否位于同一进程。

![Agent Harness 的逻辑职责与部署组件](/images/posts/agent-harness-logical-architecture.svg)

## Harness 是职责集合

最小 ReAct Loop 只需要组装输入、调用模型、执行工具并回填结果。进入线上系统后，还要处理身份、状态恢复、Memory、权限、Sandbox、事件流、并发控制、审计和 Evaluation。

这些能力共同构成 Harness，但不必由一个类或服务实现。Harness 是逻辑架构层：它说明 Agent Loop 依赖哪些能力，以及这些能力之间采用什么稳定语义。

## 跨组件合同比部署位置更重要

一个可运行的 Agent 系统至少需要以下合同：

| 合同 | 需要稳定表达 |
| --- | --- |
| Session | 用户、Agent 与会话身份 |
| Run | 一次执行的开始、暂停、终态和恢复点 |
| Event | 可重放的过程变化与顺序 |
| Tool | 参数、授权、调用标识和结果 |
| State | Checkpoint、版本与持久化边界 |

Agent Runtime、Memory Service、Tool Gateway、Sandbox Service、State Store、Message Bus 和 Evaluation Platform 可以分别消费这些合同。只要语义一致，它们在一个进程还是多个服务中，不改变其 Harness 职责。

## 框架型与服务端 Harness 侧重点不同

AgentScope 更接近以 Agent Loop 为中心的框架型 Harness：统一 Message、Event、Model、Tool、Middleware、Memory、Checkpoint 和 Workspace 接口，使后端差异不进入循环。

企业服务端 Harness 更关注分布式执行权、状态围栏、数据库、Sandbox、审批、SSE、调度和运维。两者不是替代关系：框架稳定进程内合同，服务端基础设施保证动作在多副本和故障条件下仍然成立。

## 我的选择：先统一合同，再按故障边界拆分

我会保持 Agent Runtime 小而明确，让 Memory、Tool、Sandbox 和 Evaluation 通过稳定合同接入。早期可以部署为模块化单体；当资源需求、故障域、权限或扩缩容方式明显不同，再拆成独立服务。

将全部能力集中在一个服务会扩大故障影响和资源耦合；过早拆分则增加网络、部署和一致性成本。是否拆分应由故障与运营边界决定，而不是由“Harness 包含很多能力”直接推导。

<details>
<summary>实现依据与延伸阅读</summary>

- [AgentScope](https://github.com/agentscope-ai/agentscope)
- [AgentScope Runtime Architecture](https://github.com/agentscope-ai/agentscope-runtime/blob/main/cookbook/en/intro.md)
- [模型之外，都是 Harness 的职责](/posts/agent-loop-harness/)
- [用故障合同比较 Agent 架构](/posts/agent-architecture-evaluation/)

</details>
