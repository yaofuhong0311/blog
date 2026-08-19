---
title: Agent Runtime 落地：稳定边界在会话与执行合同
published: 2026-07-18
description: 沙箱引擎负责隔离与资源，Agent Runtime 负责会话、工具和恢复；统一 Facade 应建立在多 Runtime 需求上，而不是提前抽象单一引擎。
tags: [沙箱, AI Agent, AI Infra, 学习笔记]
category: 工程实践
---

> 落地 Agent Runtime 时，最容易把精力集中在选择沙箱引擎。但引擎已经能够提供进程、文件和网络边界，真正需要长期稳定的是会话如何恢复、工具如何执行以及调用方依赖什么合同。

## 先把 Agent Runtime 与 Sandbox 分开

Sandbox 负责：

- 创建隔离环境；
- 执行命令与管理文件；
- 限制资源和网络；
- 暂停、恢复与销毁实例。

Agent Runtime 负责：

- 组装上下文并运行 Agent Loop；
- 保存 Session 与 Checkpoint；
- 路由工具与处理审批；
- 把执行结果关联回原任务。

两层可以由同一产品提供，但恢复语义不同。恢复 Sandbox 不等于恢复 Agent 会话，保存消息也不等于 Workspace 仍然存在。

## 引擎选择从工作负载出发

容器适合 GPU、完整 Linux 生态和动态资源；microVM 适合高风险不可信代码和更清晰内核边界；Wasm 适合能力封闭的固定程序。

引擎差异应留在 Adapter 中，但不能被完全隐藏。KVM、GPU、快照、持久存储和域名出口等能力需要进入平台合同，否则调用方无法判断任务是否可运行。

## Facade 只在存在多个 Runtime 时成立

Facade 可以统一：

```text
Create Session
→ Bind Workspace
→ Execute Tool
→ Checkpoint / Resume
→ Destroy
```

每个 Runtime Adapter 转换身份、状态、错误与恢复方式。它的价值是隔离已经存在的多个实现，而不是为一个固定引擎提前增加 Provider、Factory 和路由层。

如果当前只有一个引擎，我会把相关调用收敛在单一模块，等第二个具有真实差异的 Runtime 出现后再抽象公共合同。代码组织可以先清晰，架构扩展点不必提前存在。

## 当前选择：单引擎起步，合同先稳定

我会先选满足主要威胁模型和生态要求的引擎，把 Session ID、Workspace、Tool Result、错误分类和恢复流程做稳定。只有同时出现 GPU 容器任务与高风险 microVM 任务等明确分界时，才引入多 Runtime Facade。

这牺牲了早期“随时可替换”的形式完整性，却减少了没有第二实现时的猜测。引擎替换成本主要通过边界清晰和状态外置控制，而不是通过预先编写一套尚未被真实差异验证的抽象。
