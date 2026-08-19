---
title: Agent Sandbox 工程实践（二）：创建成功必须拆成四个边界
published: 2026-08-17
description: 从业务请求到 Pod 与 execd，创建链路经历多次语义转换；Accepted、Provisioned、Connected 和 Agent Ready 不能共用一个成功状态。
tags: [AI Agent, Sandbox, Kubernetes, 工程实践]
category: 工程实践
---

> Sandbox 创建不是一次 HTTP 请求，而是一条跨业务服务、CRD、Controller、Scheduler、Runtime 和健康检查的状态链。若接口只返回“成功”，上层无法知道环境究竟创建到哪一步。

![Agent Sandbox 创建链路](/images/posts/agent-sandbox-create-path.svg)

## 一条请求经历多次语义转换

```text
Agent 请求
→ sandbox-service 业务参数
→ OpenSandbox CreateSandboxRequest
→ BatchSandbox 期望状态
→ Controller Reconcile
→ Pod、Runtime、execd
```

每层都补充或转换信息：镜像、资源、Workspace、凭据、TTL 与调度条件。上游确认请求合法，不代表下游资源已经建立；CR 写入成功，也不代表 Agent 已可执行。

## 成功至少有四个边界

| 状态 | 可以保证什么 |
| --- | --- |
| Accepted | 请求合法并获得稳定操作 ID |
| Provisioned | 工作负载对象与 Pod 已建立 |
| Connected | execd 或执行面健康 |
| Agent Ready | Workspace、凭据和业务初始化完成 |

同步 API 必须明确返回哪一层。若只返回 `sandbox_id`，调用方应继续查询操作状态；若承诺 Agent Ready，就必须等待执行面和业务前置条件，而不是仅检查 Pod Running。

创建操作与 Sandbox 生命周期也应分开：操作可以 Failed 或 Succeeded，Sandbox 则经历 Pending、Running、Paused、Terminated。一个失败的等待请求，不一定意味着底层 Sandbox 不存在。

## 幂等与超时约束副作用

同一 `Idempotency-Key` 应绑定租户、操作类型和请求指纹。重复请求复用原操作；相同 Key 对应不同参数必须拒绝，不能静默返回错误资源。

超时也要分成：

- Provision Timeout：创建多久仍未 Ready 算失败；
- Lease TTL：Sandbox 最长无人续租时间；
- Command Timeout：单次执行最多运行多久。

客户端等待超时只说明没有及时拿到结果，不代表创建未发生。恢复后应查询稳定操作 ID，而不是重新创建。

## 当前选择：持久化创建操作

我会为每次创建保存操作状态、请求指纹、Sandbox ID 和各阶段时间点，并由 Controller 持续收敛资源。失败时记录失败阶段和原因，补偿逻辑只清理本次操作实际创建的对象。

代价是多一套操作状态机，但它使重试、排障和用户提示都有明确依据。只有底层创建真正同步、短暂且无跨服务副作用时，才可以退化为一次请求返回最终结果。
