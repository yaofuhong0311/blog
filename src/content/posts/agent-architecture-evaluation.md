---
title: Agent 工程（十三）：比较架构时，先看它如何失败
published: 2026-08-19
description: 功能清单只能说明系统具有什么，故障场景才能说明架构是否可靠。用四个生产问题比较两类 Agent 架构，并给出我的演进判断。
tags: [AI Agent, AI Infra, 架构, 故障恢复]
category: Agent 工程
draft: false
---

> 本文是「Agent 工程」系列第 13 篇。它只回答一个问题：**应该如何比较两套 Agent 架构？**

我最初整理了一张功能表：模型、工具、Memory、Checkpoint、Sandbox、分布式部署。后来发现，这种比较很难支持架构决策——两个系统都可以写着“支持会话恢复”，但一个恢复历史消息，另一个恢复尚未完成的 ToolCall，含义完全不同。

因此，我现在采用的判断方法是：

> 不先比较系统具有什么，而是让它们面对相同故障，再检查谁负责恢复、依据什么状态恢复。

由此得到的结论也很明确：**不需要在两类架构中选择一类并整体替换。更合理的方向，是保留已经接入生产环境的基础设施，同时吸收框架对稳定合同的组织方式。**

![两类 Agent 架构重心如何汇聚到稳定合同](/images/posts/agent-architecture-contracts.svg)

## 两类架构真正不同的是什么

为了说明问题，可以把 Agent 系统抽象成两种设计重心。这不是对具体产品的永久分类，同一系统也可能同时具有两类特征。

| 设计重心 | 优先解决的问题 | 主要优势 | 主要风险 |
| --- | --- | --- | --- |
| 合同优先 | Model、Tool、State、Workspace 如何以统一接口协作 | 实现容易替换，Agent Loop 较稳定 | 接口完整不等于生产语义完整 |
| 基础设施集成优先 | Agent 如何接入任务、权限、文件和 Sandbox | 直接复用真实运行环境与治理能力 | 底层差异容易进入 Agent Loop |

AgentScope 更接近前一种思路：用统一的 Message、Toolkit、State 和 Workspace 组织能力，再为不同实现提供扩展边界。另一类平台则通常从已有 Scheduler、MCP Runtime、Workspace、Sandbox 和权限系统出发，把 Agent 接入现有基础设施。

我的判断不是哪一类“更先进”，而是：

> 稳定合同负责控制变化范围，基础设施集成负责保证动作真实发生。生产系统同时需要两者。

Adapter 的价值也正在这里。它不只是转换字段，而要固定任务身份、状态、错误、权限与恢复语义。实现可以变化，这些合同不能随之变化。

## 四个问题，比功能清单更有区分度

我会用下面四个问题检查架构。

| 故障场景 | 需要确认的合同 | 只看功能名称会遗漏什么 |
| --- | --- | --- |
| Worker A 失去执行权后恢复 | Lease、Epoch、过期写入拒绝 | “有分布式锁”不代表旧 Worker 无法继续写 |
| Tool 已生效，结果尚未保存 | 外部任务 ID、幂等、Reconcile | “支持重试”可能造成外部动作重复 |
| 等待人工确认时服务重启 | Checkpoint、Action ID、确认结果回传 | “支持 Checkpoint”不代表确认按钮仍能定位原动作 |
| 长期记忆出现事实冲突 | 来源、作用域、更正与删除 | “支持 Memory”不代表旧事实能够被可靠修正 |

这四个问题分别对应执行权、外部副作用、人工介入和长期状态。它们有一个共同点：**恢复不能只依赖当前进程的判断，必须找到进程之外的稳定事实。**

例如，Tool 请求超时，只能说明调用方没有及时看到结果，不能说明外部任务没有创建。恢复时应先根据任务 ID 查询真实状态，而不是直接重发。这个问题在 [Agent Sandbox 状态收敛](/posts/agent-sandbox-reconcile/)中有更完整的展开。

同样，Checkpoint 保存的是“计算执行到哪里”，Action Store 保存的是“外部用户正在确认哪个动作”。二者缺少任何一个，跨进程 HITL 都不完整。

Lock、CAS 与 Fencing Token 也不能合并成一个概念：Lock 控制当前准入，CAS 原子更新所有权，Fencing Token 让存储拒绝旧持有者写入。存在其中一个，不代表执行权转移已经闭环。

至于 Memory，统一接口只能降低存储替换成本。事实来源、冲突、更正和遗忘仍然需要独立治理；这部分可继续阅读 [四类记忆](/posts/agent-memory-layers/)和 [AgentScope Memory 生命周期](/posts/agentscope-memory-lifecycle/)。

## 这次比较改变了我的什么判断

如果只比较模块，我可能会倾向于选择功能更完整的框架，然后逐步替换现有 Runtime。

按故障场景重新比较后，我的选择发生了变化：

1. **保留已经验证的基础设施集成。** 任务、权限、Workspace 和 Sandbox 的真实语义，不应为了匹配框架对象模型而重写。
2. **补齐 Agent Loop 与基础设施之间的稳定合同。** 优先统一任务身份、状态转换、错误分类和恢复方式。
3. **只在现有实现无法满足合同的地方替换组件。** 不做整体迁移，也不为了架构形式一致而增加组件。

验证顺序也应当相应调整：

```text
定义故障场景
    → 写清状态与恢复合同
    → 注入故障并检查外部副作用
    → 再决定是否替换实现
```

这比先选框架再迁移更克制，也更容易判断一次改造是否真正提高了可靠性。

## 这篇文章不能证明什么

本文没有完成同一环境下的吞吐、延迟和资源成本测试，也没有证明某套系统的所有写入都受到 Fencing 保护。

看到 Lock、Permission、Sandbox、Trace 或 Memory 接口，只能说明控制点存在。它们是否构成完整的多租户隔离、故障恢复和质量闭环，仍需要源码检查、故障注入与真实指标验证。

所以，这次架构对比最终留下的不是一个产品排名，而是一套更适合我的评价方法：

> 功能决定系统能否开始运行；故障合同决定它在生产环境中能否继续正确运行。

## 参考资料

- [AgentScope：State / Session Management](https://doc.agentscope.io/tutorial/task_state.html)
- [AgentScope：Tool](https://doc.agentscope.io/tutorial/task_tool.html)
- [AgentScope：Core Agent and Workspace](https://github.com/agentscope-ai/agentscope/blob/main/CONTRIBUTING.md)

