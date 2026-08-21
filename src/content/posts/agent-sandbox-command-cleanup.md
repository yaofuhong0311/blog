---
title: Agent Sandbox 工程实践（四）：Command 超时不等于 Sandbox 回收
published: 2026-08-21T09:00:00+08:00
description: Command timeout 只应终止本次执行的进程集合；Sandbox 回收处理整个运行载体，PID 1 则负责容器内的进程生命周期。
tags: [AI Agent, Sandbox, OpenSandbox, 进程管理]
category: 工程实践
---

> 清理逻辑是否正确，首先取决于系统准备清理哪个集合。Command 超时、Sandbox TTL 和 PID 1 分别处理一次执行、整个运行载体和容器内进程生命周期，不能使用同一种终止方式代替。

![Command、Sandbox 与 PID 1 的清理边界](/images/posts/agent-sandbox-command-cleanup.svg)

## 先确定清理对象，再选择终止机制

一次 Command 可能经过 Shell 创建多个子孙进程。Command 超时只表示这次执行不应继续，Sandbox 仍可能需要接受后续命令；Sandbox TTL 到期则表示整个运行载体失效，应同时回收进程、CPU、内存、网络端点和临时文件系统。

| 事件 | 清理范围 | 应继续保留 |
| --- | --- | --- |
| Command timeout | 本次命令产生的进程集合 | Sandbox、其他命令与 Workspace |
| Sandbox TTL 到期 | 整个容器或虚拟机 | 独立持久化的 Workspace、任务记录与日志 |
| 容器主进程退出 | 当前 PID Namespace | 由外部 Runtime 决定是否重启或重建 |

客户端等待超时也不等于执行已经停止；只有服务端取消对应 Command，才能终止其副作用。

## 进程组负责一次 Command 的协同终止

只终止最外层 Shell 可能留下继续运行的子进程。OpenSandbox 的 execd 为普通命令建立独立进程组；超时或中断时向整个进程组发送信号，先给进程正常退出的机会，超过宽限期后再使用 `SIGKILL`，并等待直接子进程退出。

进程组负责协同清理，不是安全隔离，也不会回收网络、挂载和 cgroup。不可信代码的最终边界仍应是可整体销毁的运行载体。

## PID 1 管理生命周期，不代表 Sandbox 健康

PID 1 接收容器停止信号、接管孤儿进程并回收子进程；它退出时，容器中的进程空间也随之终止。

PID 1 不是 root，也不是信息流入口。它存活只能证明容器主进程尚在，不能证明 execd 或业务入口健康。

当前 OpenSandbox 由 `bootstrap.sh` 担任 PID 1，execd 与用户入口是兄弟进程，因此 execd 失效后容器仍可能显示 Running。[OSEP-0018](https://github.com/opensandbox-group/OpenSandbox/blob/main/oseps/0018-execd-as-sandbox-init.md) 提议让 execd 成为 Sandbox init，但目前仍是 draft。

## 我的选择：分层清理，并让健康检查覆盖功能

我会把清理策略固定在三个层级：

1. Command 层使用独立进程组，采用 `SIGTERM → 宽限期 → SIGKILL`；
2. Sandbox 层通过删除或可信重置运行载体完成最终清理；
3. Workspace、任务状态和日志独立持久化，不跟随临时运行载体删除。

readiness 应验证 execd 等关键功能，而不是只检查 PID 1 或 Pod Phase。Warm Pool 执行多租户不可信代码时，重新分配前必须证明进程、临时文件、网络状态和凭据均已清除。

平台因此需要分别维护 Command 状态、Sandbox 生命周期和持久化资源引用，但不会因一次命令失败就错误删除仍有价值的数据。

<details>
<summary>实现依据与延伸阅读</summary>

- [OpenSandbox OSEP-0018：execd as Sandbox Init](https://github.com/opensandbox-group/OpenSandbox/blob/main/oseps/0018-execd-as-sandbox-init.md)
- [OpenSandbox Architecture](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/architecture.md)
- [Agent Sandbox 工程实践（二）：创建请求为什么必须持久化](/posts/agent-sandbox-create-path/)

</details>
