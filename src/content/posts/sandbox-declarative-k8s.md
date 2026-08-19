---
title: 沙箱系列（四）：声明式控制面保存的是期望状态
published: 2026-07-18
description: CRD 定义 Sandbox 的期望状态，Controller 持续对比现实并收敛；可靠性来自重复 Reconcile，而不是一次创建命令。
tags: [沙箱, Kubernetes, Controller, 学习笔记]
category: 沙箱系统
---

> 在 Kubernetes 中管理 Sandbox，核心不是把“创建 Pod”封装成一个 API，而是保存期望状态，并让 Controller 在故障、重启和人工修改后持续把现实收敛回来。

## CRD 定义名词，Controller 实现动作

CRD 让 API Server 认识 `Sandbox` 类型、字段和校验规则。创建资源对象后，它只是一份持久化声明，不会自动产生 Pod。

Controller 观察 Sandbox 与实际资源：

```text
读取期望状态
→ 读取现实状态
→ 计算差异
→ 创建、更新或清理资源
→ 再次检查
```

因此 CRD 是调用方与 Controller 的合同，Controller 才负责解释隔离级别、镜像、资源和生命周期字段。

## Reconcile 必须可重复执行

Controller 可能因为事件重复、进程重启或定时同步多次处理同一对象。Reconcile 不能假设自己只运行一次，也不能把正确性建立在本地调用栈上。

创建前先查询现状、使用稳定 Owner Reference、按资源版本更新 Status，使重复执行得到相同终态。一次 API 调用失败只代表本轮未完成，后续循环仍会继续收敛。

这与命令式流程的区别在于：失败不是流程永久中断，而是“期望与现实仍不一致”，Controller 下一轮继续处理。

## 生命周期动作也应表示为状态

例如 Sandbox 超时后需要先快照再终止，不能只按顺序调用两个接口。更可靠的做法是让 Status 表达阶段：

```text
Running
→ Snapshotting
→ SnapshotReady
→ Terminating
→ Terminated
```

Controller 每次根据当前阶段决定下一项动作。即使进程在快照完成后崩溃，新副本也能从持久化状态继续，而不是重新猜测快照是否存在。

## 我的判断：只把需要持续收敛的对象做成 CRD

我会为长生命周期、需要跨重启恢复和持续观测的 Sandbox 建立 CRD 与 Controller。一次性、无状态且失败后直接重试即可的操作，普通服务接口更简单。

声明式设计的代价是状态机、幂等和最终一致性测试。它不会自动解决底层创建失败，但能让失败位置和恢复责任有稳定表达。只有 Controller 能根据外部事实反复收敛时，CRD 才不只是另一层数据包装。
