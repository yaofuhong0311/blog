---
title: Agent Sandbox 工程实践（二）：创建 Sandbox 不是一次 HTTP 请求
published: 2026-08-17
description: 从 sandbox-service、OpenSandbox、BatchSandbox、Pod 与 execd 的真实创建链路出发，分析创建完成的不同边界，以及两套状态机、三类时钟与持久化幂等如何共同保证可靠性。
tags: [Agent Sandbox, Kubernetes, 控制面]
category: 工程实践
draft: false
---

> 本文是「Agent Sandbox 工程实践」系列第 2 篇。上一篇讨论了[为什么控制面需要状态收敛](/posts/agent-sandbox-reconcile/)，这一篇沿着一次真实的创建请求，继续分析控制面如何把业务意图转换为可执行、可观测和可恢复的 Sandbox。

调用方发起创建请求时，表达的通常只是一个业务目标：

> 创建一个具有指定镜像、资源、目录、网络策略和生命周期的 Agent 执行环境。

这个目标不能直接等同于启动一个进程。它需要依次经过参数策略、期望状态落地、Kubernetes 调度、容器运行时隔离和执行服务检查。任何一层失败，都可能形成不同的中间状态。

因此，“创建 Sandbox”不应被理解为一次普通的 HTTP 请求，而应被理解为一个跨越多个控制层的创建操作。

![一次 Sandbox 创建请求的逐层转换](/images/posts/agent-sandbox-create-path.svg)

## 一、每一层都在转换一种描述

当前创建链路可以概括为：

```text
Agent 请求
  → sandbox-service 创建参数
  → OpenSandbox CreateSandboxRequest
  → BatchSandbox 自定义资源
  → Controller Reconcile
  → Pod
  → scheduler 与 kubelet
  → container runtime
  → sandbox 主进程与 execd
```

这不是同一份参数在不同服务之间原样转发，而是多次语义转换。

### 1. sandbox-service：形成业务创建合同

`POST /v1/sandboxes/agent-ready` 接收的是面向 Agent 的业务参数。服务会选择预构建镜像或 fallback 镜像，补充 entrypoint、环境变量和 metadata，并设置 CPU、内存、GPU 的 requests 与 limits，以及 Workspace 和额外挂载。

这一层回答的是：

- 使用哪个 Agent 环境；
- 注入哪些业务配置与凭证；
- 挂载哪些目录；
- 分配多少资源；
- Sandbox 最长存活多久。

它决定“要创建什么”，但不直接创建 Pod，也不负责建立内核隔离。

接口还会在调用下游前占用 `Idempotency-Key`。同一个键并发到达时，只有第一个请求负责创建，其余请求等待并复用结果。这项机制避免了单个服务进程内的并发重复创建，但其可靠范围仍需在后文单独说明。

### 2. OpenSandbox：形成工作负载期望

OpenSandbox 接收 `CreateSandboxRequest` 后，会校验 extension、HostPath 白名单，以及 Pool 与 Volume 的兼容性，并生成 `sandbox_id`、过期时间、标签和访问上下文。

在当前 Kubernetes runtime 与 BatchSandbox provider 的组合下，provider 会继续生成：

- Sandbox 主容器；
- 安装 execd 的 init container；
- 保存执行组件的 `emptyDir`；
- 资源约束和卷；
- 可选的网络策略；
- `replicas=1` 的 BatchSandbox CR。

OpenSandbox 写入的不是“立即在某个节点上启动进程”的命令，而是“集群中应该存在一个符合这些约束的 Sandbox”。

### 3. BatchSandbox：保存高于 Pod 的期望状态

BatchSandbox CR 不是对 Pod 字段的简单复制。它除了承载 PodTemplate 中的镜像、资源和挂载，还可以表达 `expireTime`、副本、Pool、Pause、Resume 和 Snapshot 等 Sandbox 语义。

这里需要区分三个概念：

| 对象 | 职责 |
| --- | --- |
| CRD | 定义 BatchSandbox 资源的结构和 API |
| CR | 保存某一个 Sandbox 的期望状态 |
| Controller | 持续读取 CR，并创建、删除或更新实际 Pod |

当前 `replicas=1`，因此一个 BatchSandbox 通常对应一个 Pod。但这种对应关系来自 Controller 的实现，不代表 BatchSandbox 与 Pod 是同一个对象。

### 4. Kubernetes：把期望状态物化为进程

Controller 观察到新的 BatchSandbox 后，根据期望状态生成 Pod。scheduler 为 Pod 选择节点，kubelet 再调用容器运行时完成镜像准备、namespace 和 cgroup 配置、卷挂载与进程启动。

到这一层，抽象的创建合同才真正转化为节点上的进程。

execd 的安装过程也在这条链路中完成。它为后续命令执行提供稳定入口，使调用方不必直接操作容器运行时。Sandbox 主进程已经启动，并不自动意味着 execd 已经可以接受请求。

## 二、“创建成功”至少存在四个边界

创建链路越长，越不能只用一个 `success` 描述全部状态。至少需要区分以下四个完成边界。

### 1. CR 已写入

这只说明 Kubernetes API Server 已经接受期望状态。此时可能还没有 Pod，也可能暂时没有节点能够承载它。

适合表达为“创建请求已被控制面接受”，不适合向 Agent 承诺环境已经可用。

### 2. Pod 已进入 Running 或工作负载已分配

这说明调度和容器启动已经取得实质进展。当前 OpenSandbox 的 Kubernetes 创建实现会等待工作负载进入 Running 或 Allocated；明确不可调度时直接失败，等待超时后返回创建失败，并尝试清理已经创建的 BatchSandbox。

因此，不能只根据上层调用处的旧注释推断接口会在 CR 写入后立即返回。跨仓库判断必须以当前实际被调用的实现为准。

### 3. execd 健康

Pod Running 只说明容器主进程已经运行，并不证明命令执行通道可用。后续的 `Sandbox.connect` 还会检查 execd 健康状态。

这一步把“容器已启动”推进到“Sandbox 执行接口可连接”。

### 4. Agent Ready

平台还可能要求 Workspace、凭证、依赖或业务初始化已经满足 Agent 的执行条件。只有这些前置条件全部完成，才适合将环境暴露为 Agent Ready。

因此，我更倾向于在接口和监控中明确区分：

```text
Accepted  →  Provisioned  →  Connected  →  Agent Ready
```

如果产品接口只需要同步返回一次，返回边界也必须被写入合同：调用方得到的是 `sandbox_id`，还是一个已经通过执行面健康检查的 Sandbox。否则，上层会把偶发的初始化失败误认为命令执行失败。

## 三、创建操作与 Sandbox 是两套状态机

当平台引入持久化队列后，“创建 Sandbox”本身会成为一个可查询、可恢复的异步操作。这个操作和创建出来的 Sandbox 具有不同生命周期。

![创建操作、Sandbox 生命周期与三类时间约束](/images/posts/agent-sandbox-create-state.svg)

### 1. 创建操作状态

```text
QUEUED → CREATING → SUCCEEDED
                  ↘ FAILED
QUEUED / CREATING → CANCELLED
```

它回答的是“这次创建请求处理到哪一步”。一旦进入 `SUCCEEDED`，创建操作已经结束。

### 2. Sandbox 生命周期

```text
Pending → Running → Ready → Stopping → Terminated
```

它回答的是“创建出来的长期资源当前处于什么状态”。创建操作结束后，Sandbox 仍会继续运行，直到 TTL 到期或被主动删除。

把两套状态合并，会产生两个典型问题：

- 创建操作已经失败，但遗留的 CR 或 Pod 仍然存在；
- Sandbox 已经终止，但历史创建操作仍应保留为 `SUCCEEDED`，不能被改写为失败。

可靠的控制面需要分别保存操作记录与资源状态，再通过 `sandbox_id` 建立关联。

## 四、状态转换必须具备原子性

多个 Worker 可能同时读取到同一个 `QUEUED` 操作。消息队列也可能重复投递，Worker 崩溃前尚未确认的消息还可能再次出现。

如果程序先读取状态，再单独写入 `CREATING`，两个 Worker 就可能同时认为自己取得了执行资格，并分别调用 OpenSandbox。数据库最终可能只显示一条 `CREATING` 记录，外部却已经创建两个 Sandbox。

因此，领取任务应通过一次条件更新完成：

```sql
UPDATE sandbox_operations
SET
  status = 'CREATING',
  version = version + 1,
  lease_owner = :worker_id,
  lease_until = :lease_until
WHERE id = :operation_id
  AND status = 'QUEUED'
  AND version = :expected_version;
```

只有更新行数为一的 Worker 获得创建资格。更新行数为零表示状态已经发生变化，需要重新读取后再决策。

一条可靠的创建操作记录至少需要：

- `status`：当前处理阶段；
- `version`：防止旧观察覆盖新状态；
- `lease_owner` 与 `lease_until`：标识当前处理者并允许故障接管；
- `idempotency_key`：关联同一业务意图；
- `request_fingerprint`：确认重试请求没有改变创建规格；
- `sandbox_id`：保存已经产生的外部资源。

租约、幂等与 Reconcile 解决的是不同问题：租约决定当前谁可以处理，幂等防止重试重复产生有效副作用，Reconcile 则让操作记录重新对齐实际 Sandbox。

## 五、幂等保证的是一次有效副作用

分布式系统无法保证创建请求在网络上只发送一次。响应可能丢失，队列可能重复投递，Worker 可能在请求发出后崩溃。

因此，创建接口需要保证的不是 Exactly Once Delivery，而是：

> 同一个业务意图可以被发送多次，但最终只产生一个有效 Sandbox，并且后续请求能够重放同一个结果。

当前 sandbox-service 会在调用 OpenSandbox 前用 Future 占用幂等键。同键请求等待并复用同一个 `sandbox_id`。这对单副本 test/dev 环境有效，但进程内存具有明确边界：

- 服务重启后记录消失；
- 有界表淘汰键后可能再次创建；
- 多副本请求可能落到不同进程；
- 只比较原始 key，无法识别同键不同规格。

生产实现更适合在 Redis 或数据库中保存：

```text
(tenant_id, api_name, idempotency_key)
  → request_fingerprint
  → operation_status
  → sandbox_id
  → replayable_response
```

同一作用域、同一 key、同一 fingerprint 表示安全重试；同一 key 但 fingerprint 不同，应返回 `409 Conflict`，不能直接复用第一次结果。

## 六、三类时间约束不能共用一个“超时”

Sandbox 创建与使用过程中至少存在三类独立时间约束。

### 1. Provision Timeout

它限制调度、镜像准备和工作负载启动最多允许花费多久。超时表示本次创建没有在规定时间内达到承诺边界。

仓库部署配置中存在 300 秒的创建等待上限，但线上实际值仍应以当前部署配置为准，不能直接把仓库默认值当作生产事实。

### 2. Lease TTL

它限制整个 Sandbox 最晚存活到什么时间。当前实现会在创建请求开始时计算：

```text
expiresAt = createdAt + timeout
```

这意味着调度、拉取镜像和启动过程会消耗可用 TTL。若业务承诺的是“Ready 后仍可使用完整时长”，控制面就需要在 Ready 后续期，或者从模型上分离创建期限与使用租约。

### 3. Command Timeout

它只约束一次 exec。命令超时通常终止相应进程或进程组，不等于删除整个 Sandbox。

但 Lease TTL 具有更高的资源生命周期约束：如果 Sandbox 先到期，Pod 被删除，正在执行的命令也会随之终止。

将三者压缩成一个 `timeout` 参数，会让调用方无法判断应该重试创建、重试命令，还是重新申请 Sandbox。

## 七、如果由我调整当前创建控制面

我不会立即把同步创建接口改造成完整的分布式任务平台。当前单副本、请求量可控的阶段，进程内 Future 已经能够解决最直接的并发重复创建问题。

我会先完成三项边界明确、收益直接的调整。

### 1. 明确同步接口的成功合同

接口文档、状态码和监控统一到实际实现：OpenSandbox 等待 Running 或 Allocated，`Sandbox.connect` 再验证 execd。上层不再根据过期注释推断“创建请求立即返回”。

### 2. 为幂等键增加作用域与请求指纹

即使仍使用进程内表，也应将键扩展为租户、API 与幂等键的组合，并保存规范化请求指纹。这样可以先消除跨租户碰撞和同键不同规格被静默合并的问题。

### 3. 独立记录各阶段耗时

至少记录参数构造、OpenSandbox 创建、工作负载就绪和 execd 健康检查的耗时。创建超时时，能够明确瓶颈位于控制面、调度、镜像准备还是执行服务初始化。

当出现以下任一条件时，再引入持久化创建 operation、共享队列和 Worker 租约：

- 创建请求出现明显突发流量；
- 服务需要多副本部署；
- 进程重启后必须继续恢复未完成创建；
- API Server、调度器或镜像仓库需要创建背压；
- 租户之间需要并发配额与公平调度。

这时，队列应位于调用 OpenSandbox 之前。`QUEUED` 阶段不创建 BatchSandbox 和 Pending Pod，也不提前消耗 Sandbox TTL。容量上限、创建并发、资源配额和租户公平，则需要作为独立的平台治理问题继续设计。

## 结语

一次 Sandbox 创建请求实际经过了三次关键转换：

1. 业务需求转换为创建合同；
2. 创建合同转换为 Kubernetes 期望状态；
3. 期望状态转换为节点上的隔离进程与执行通道。

这条链路决定了控制面不能只保存一个 `sandbox_id` 和一个模糊的 `success`。只有区分完成边界、操作状态、资源状态和时间约束，创建过程才具备可观测、可恢复和可扩展的基础。

下一步需要讨论的已经不再是“能否创建”，而是“平台如何在突发请求下控制创建速度、资源容量和租户公平”。这是创建链路从功能可用走向平台化必须补上的另一层能力。
