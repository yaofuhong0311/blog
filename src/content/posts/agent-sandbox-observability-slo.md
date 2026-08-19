---
title: Agent Sandbox 工程实践（三）：总创建耗时无法定位性能问题
published: 2026-08-18
description: Ready Latency 只能描述用户等待，必须拆分队列、资源创建、调度、容器启动和健康检查，才能形成可治理 SLO。
tags: [AI Agent, Sandbox, Observability, SLO]
category: 工程实践
---

> 端到端 Ready Latency 是必要的用户指标，却不能解释 Sandbox 为什么慢。创建链路跨越多个责任边界，只有记录阶段时间点和稳定失败分类，SLO 未达标时才能选择正确动作。

![Agent Sandbox 创建链路的阶段指标](/images/posts/agent-sandbox-stage-metrics.svg)

## 状态说明位置，时间点说明成本

`QUEUED`、`CREATING`、`READY` 和 `FAILED` 适合恢复与展示，但同一个 `CREATING` 可能正在等待调度、拉取镜像或启动 execd。

我会记录：

```text
t0 请求入队
t1 Worker 领取
t2 资源对象创建
t3 Pod 调度完成
t4 容器运行
t5 execd 健康
```

相邻时间点分别得到 Queue、Controller、Scheduler、Runtime 和 Health 阶段耗时。每一段异常对应不同责任方，不能统一解释为“集群容量不足”。

## Metric、SLI 与 SLO 分别承担什么

- Metric 是原始测量，例如队列长度、阶段耗时和失败数量；
- SLI 是用户关心的表现，例如成功创建比例与 Ready Latency；
- SLO 是目标，例如 99% 创建在指定时间内 Ready。

SLI 的分母必须明确。用户取消、参数错误、容量不足和平台故障是否计入同一成功率，会直接改变结论。失败分类不稳定，SLO 数字就没有可比性。

## SLO 未达标不能直接推出扩容

阶段指标决定行动：

| 慢点 | 优先检查 |
| --- | --- |
| Queue | Worker 吞吐与背压 |
| Resource Create | API Server 与 Controller |
| Schedule | 资源碎片、GPU 和节点约束 |
| Container Start | 镜像缓存、卷和 Runtime |
| Health | entrypoint、依赖与 execd |

扩容只能改善其中部分阶段。镜像拉取、错误探针或严格调度约束不会因为增加 Controller 副本自动消失。

## 当前选择：端到端指标与阶段指标并存

我会保留 Ready Latency 作为用户 SLI，同时在创建操作中持久化阶段时间点、失败类型和关联资源 ID。先用真实分布定义 SLO，再建立分阶段告警。

代价是指标维度与链路关联增加，需要控制标签基数。若系统规模较小，也至少应记录五个关键时间点；仅有总耗时只能发现“变慢了”，不能指导修复。
